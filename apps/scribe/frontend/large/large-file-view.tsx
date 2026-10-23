import { useI18n } from '@syntelab/i18n';
import { AppInvokeError, fileName, useTabCommands } from '@syntelab/shell-api';
import type { AppViewProps } from '@syntelab/shell-api';
import { Button, Icon } from '@syntelab/ui-kit';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { otherTabCommands } from '../commands';
import { openCompareTab } from '../compare/open-compare';
import { openFolderSearchTab, openNewTextTab, openTextInTab } from '../document/open-text';
import { rememberText } from '../document/recent-texts';
import { fileProblem } from '../document/text-file';
import { loadRecipes, operationsOf } from '../recipes/recipe-store';
import styles from './large-file-view.module.css';
import { pageOf, PAGE_LINES, pagesOf, sizeText } from './pages';

/** What `large_open` says of the file. */
interface Facts {
  readonly size: number;
  readonly lines: number;
  readonly encoding: string;
}

/** A place where the pattern was found, as `large_find` gives it. */
interface Match {
  readonly line: number;
  readonly text: string;
  readonly from: number;
  readonly to: number;
}

const FLAGS = ['regex', 'caseSensitive', 'wholeWord'] as const;
type Flags = Readonly<Record<(typeof FLAGS)[number], boolean>>;

/** What is said after a recipe ran on the file. */
type Ran = { readonly kind: 'written'; readonly path: string } | { readonly kind: 'unchanged' } | { readonly kind: 'problem'; readonly key: string };

/** A line with the match in it marked. Positions count characters, not the units JavaScript counts in. */
function MatchLine({ match }: { match: Match }) {
  const letters = [...match.text];
  return (
    <span className={styles.matchText}>
      {letters.slice(0, match.from).join('')}
      <mark>{letters.slice(match.from, match.to).join('')}</mark>
      {letters.slice(match.to).join('')}
    </span>
  );
}

/**
 * A file too large for the editor: shown a page of lines at a time, read
 * from the file as it is asked for. It can be looked through, searched, and
 * given to a recipe whose result goes into another folder; it is not
 * changed here.
 */
export function LargeFileView({ host, path }: AppViewProps & { readonly path: string }) {
  const { t, language } = useI18n();
  const { invoke } = host;
  const [facts, setFacts] = useState<Facts | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** The page shown, from 0, and its lines; null while they are read. */
  const [page, setPage] = useState(0);
  const [lines, setLines] = useState<readonly string[] | null>(null);
  /** The line (from 1) to be shown marked: where a search or "go to line" led. */
  const [marked, setMarked] = useState<number | null>(null);
  const [goTo, setGoTo] = useState('');
  const [find, setFind] = useState('');
  const [flags, setFlags] = useState<Flags>({ regex: false, caseSensitive: false, wholeWord: false });
  const [matches, setMatches] = useState<readonly Match[] | null>(null);
  /** The line to search on from, when there may be more to find. */
  const [next, setNext] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [findProblem, setFindProblem] = useState<{ key: string; detail?: string } | null>(null);
  const recipes = useMemo(() => loadRecipes(host), [host.active]);
  const [recipe, setRecipe] = useState('');
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState<Ran | null>(null);
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<Facts>('large_open', { path }).then(
      (opened) => {
        if (cancelled) return;
        setFacts(opened);
        rememberText(host, path);
      },
      (error) => {
        if (cancelled) return;
        const code = error instanceof AppInvokeError ? error.code : null;
        setProblem(code === 'not-paged' ? 'scribe.large.notPaged' : fileProblem(error, 'scribe.problem.cannotOpen').key);
      },
    );
    return () => {
      cancelled = true;
    };
    // A tab keeps its file for as long as it lives.
  }, []);

  useEffect(() => {
    if (!facts) return;
    let cancelled = false;
    setLines(null);
    invoke<{ lines: string[] }>('large_lines', { path, from: page * PAGE_LINES, count: PAGE_LINES }).then(
      (read) => !cancelled && setLines(read.lines),
      () => !cancelled && setLines([]),
    );
    return () => {
      cancelled = true;
    };
  }, [facts, page, invoke, path]);

  // The line a search led to is brought into view once its page is there.
  useEffect(() => {
    if (lines === null || marked === null) return;
    list.current?.querySelector('[data-marked="true"]')?.scrollIntoView({ block: 'center' });
  }, [lines, marked]);

  const show = useCallback(
    (line: number) => {
      if (!facts) return;
      const shown = Math.min(Math.max(Math.round(line), 1), Math.max(facts.lines, 1));
      setMarked(shown);
      setPage(pageOf(shown));
    },
    [facts],
  );

  const search = async (from: number) => {
    setSearching(true);
    setFindProblem(null);
    try {
      const found = await invoke<{ matches: Match[]; next: number | null }>('large_find', { path, replacement: { find, ...flags }, from });
      setMatches((before) => (from === 0 || before === null ? found.matches : [...before, ...found.matches]));
      setNext(found.next);
    } catch (error) {
      const code = error instanceof AppInvokeError ? error.code : null;
      setFindProblem(code === 'bad-pattern' ? { key: 'scribe.tools.badPattern', detail: error instanceof Error ? error.message.replace(/^bad-pattern:\s*/, '') : undefined } : { key: 'scribe.folder.failed' });
    } finally {
      setSearching(false);
    }
  };

  const runRecipe = async () => {
    const chosen = recipes.find((known) => known.id === recipe);
    if (!chosen) return;
    const folder = await host.pickFolder();
    if (folder === null) return;
    setRunning(true);
    setRan(null);
    try {
      const answer = await invoke<{ files: { written: string | null; problem: string | null }[] }>('run_on_files', { files: [{ path, under: '' }], operations: operationsOf(chosen.steps, language), folder });
      const [file] = answer.files;
      if (file?.written) setRan({ kind: 'written', path: file.written });
      else if (file?.problem) setRan({ kind: 'problem', key: `scribe.recipes.problem.${file.problem}` });
      else setRan({ kind: 'unchanged' });
    } catch {
      setRan({ kind: 'problem', key: 'scribe.tools.failed' });
    } finally {
      setRunning(false);
    }
  };

  const commands = useMemo(
    () =>
      otherTabCommands({
        onNew: () => openNewTextTab(host, t('scribe.file.untitled')),
        onOpen: async () => {
          for (const picked of await host.pickFiles({ typeName: t('scribe.file.anyType'), extensions: ['*'], multiple: true })) openTextInTab(host, picked);
        },
        onCompareFiles: () => openCompareTab(host, t('scribe.compare.title')),
        onCompareTexts: () => openCompareTab(host, t('scribe.compare.title'), null, null, true),
        onFindInFolder: () => openFolderSearchTab(host, t('scribe.folder.title')),
        onClose: () => host.closeTab(),
        onSettings: host.openSettings,
      }),
    // `host` changes when the tab moves to the back; what it opens does not.
    [host.openTab, host.closeTab, host.openSettings, host.pickFiles, t],
  );
  useTabCommands(host, commands);

  if (problem) {
    return (
      <div className={styles.view}>
        <p className={styles.waiting} role="alert">
          {t(problem)}
        </p>
      </div>
    );
  }
  if (!facts) {
    return (
      <div className={styles.view}>
        <p className={styles.waiting} role="status">
          {t('scribe.large.reading')}
        </p>
      </div>
    );
  }

  const pages = pagesOf(facts.lines);
  const first = page * PAGE_LINES + 1;
  const number = new Intl.NumberFormat(language);

  return (
    <div className={styles.view}>
      <div className={styles.top}>
        <div className={styles.about}>
          <Icon name="circle-info" size={16} />
          <p>
            <strong>
              <bdi>{fileName(path)}</bdi>
            </strong>{' '}
            {t('scribe.large.facts', { size: sizeText(facts.size, language), lines: facts.lines, encoding: facts.encoding })} {t('scribe.large.about')}
          </p>
          <Button onClick={() => host.openTab({ key: `whole:${path}`, title: fileName(path), params: { path, whole: '1' } })}>{t('scribe.large.openWhole')}</Button>
        </div>

        <form
          className={styles.row}
          onSubmit={(event) => {
            event.preventDefault();
            if (find !== '' && !searching) void search(0);
          }}
        >
          <input type="text" className={styles.control} dir="auto" spellCheck={false} value={find} placeholder={t('scribe.field.find')} aria-label={t('scribe.field.find')} onChange={(event) => setFind(event.target.value)} />
          {FLAGS.map((flag) => (
            <label key={flag} className={styles.flag}>
              <input type="checkbox" checked={flags[flag]} onChange={(event) => setFlags({ ...flags, [flag]: event.target.checked })} />
              {t(`scribe.field.${flag}`)}
            </label>
          ))}
          <Button type="submit" variant="primary" disabled={find === '' || searching}>
            {t(searching ? 'scribe.tools.working' : 'scribe.folder.search')}
          </Button>
        </form>
        {findProblem && (
          <p className={styles.problem} role="alert">
            {t(findProblem.key)}
            {findProblem.detail && <bdi dir="ltr"> {findProblem.detail}</bdi>}
          </p>
        )}

        {recipes.length > 0 && (
          <div className={styles.row}>
            <select className={styles.control} value={recipe} aria-label={t('scribe.large.recipe')} onChange={(event) => setRecipe(event.target.value)}>
              <option value="">{t('scribe.large.recipe')}</option>
              {recipes.map((known) => (
                <option key={known.id} value={known.id}>
                  {known.name}
                </option>
              ))}
            </select>
            <Button disabled={recipe === '' || running} onClick={() => void runRecipe()}>
              {t(running ? 'scribe.tools.working' : 'scribe.large.runInto')}
            </Button>
            {ran?.kind === 'written' && (
              <span className={styles.said} role="status">
                {t('scribe.large.written')} <bdi dir="ltr">{ran.path}</bdi>
                <Button variant="ghost" onClick={() => void host.showInFolder(ran.path)}>
                  {t('scribe.large.showInFolder')}
                </Button>
              </span>
            )}
            {ran?.kind === 'unchanged' && (
              <span className={styles.said} role="status">
                {t('scribe.tools.nothingChanged')}
              </span>
            )}
            {ran?.kind === 'problem' && (
              <span className={styles.problem} role="alert">
                <bdi>{fileName(path)}</bdi>: {t(ran.key)}
              </span>
            )}
          </div>
        )}
      </div>

      <div className={styles.work}>
        <div className={styles.text}>
          <div className={styles.pager}>
            <Button disabled={page === 0} onClick={() => setPage(page - 1)}>
              <Icon name="chevron-up" size={12} />
              {t('scribe.large.previous')}
            </Button>
            <span className={styles.where}>{t('scribe.large.shown', { from: number.format(first), to: number.format(Math.min(first + PAGE_LINES - 1, facts.lines)), count: number.format(facts.lines) })}</span>
            <Button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
              <Icon name="chevron-down" size={12} />
              {t('scribe.large.next')}
            </Button>
            <form
              className={styles.goTo}
              onSubmit={(event) => {
                event.preventDefault();
                const line = Number(goTo);
                if (Number.isFinite(line) && line >= 1) show(line);
              }}
            >
              <input type="number" className={styles.control} min={1} max={Math.max(facts.lines, 1)} value={goTo} placeholder={t('scribe.large.line')} aria-label={t('scribe.large.line')} onChange={(event) => setGoTo(event.target.value)} />
              <Button type="submit" disabled={goTo === ''}>
                {t('scribe.large.go')}
              </Button>
            </form>
          </div>
          {lines === null ? (
            <p className={styles.waiting} role="status">
              {t('scribe.file.reading')}
            </p>
          ) : (
            <ol ref={list} className={styles.lines} start={first} dir="auto">
              {lines.map((line, index) => (
                <li key={first + index} data-marked={first + index === marked}>
                  <span className={styles.number}>{first + index}</span>
                  <span className={styles.line} dir="auto">
                    {line}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {matches !== null && (
          <aside className={styles.found} aria-label={t('scribe.large.found')}>
            <p className={styles.foundLead}>{t(matches.length === 0 ? 'scribe.large.nothingFound' : next === null ? 'scribe.large.foundAll' : 'scribe.large.foundSome', { count: matches.length })}</p>
            <ol className={styles.matches}>
              {matches.map((match, index) => (
                <li key={`${match.line}-${match.from}-${index}`}>
                  <button type="button" className={styles.match} onClick={() => show(match.line)}>
                    <span className={styles.matchLine}>{match.line}</span>
                    <MatchLine match={match} />
                  </button>
                </li>
              ))}
            </ol>
            {next !== null && (
              <Button disabled={searching} onClick={() => void search(next)}>
                {t(searching ? 'scribe.tools.working' : 'scribe.large.findMore')}
              </Button>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
