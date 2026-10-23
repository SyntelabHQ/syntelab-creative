import { useI18n } from '@syntelab/i18n';
import { AppInvokeError, fileName, useTabCommands } from '@syntelab/shell-api';
import type { AppViewProps } from '@syntelab/shell-api';
import { Button, Icon } from '@syntelab/ui-kit';
import { useMemo, useState } from 'react';
import { otherTabCommands } from '../commands';
import { openCompareTab } from '../compare/open-compare';
import { openNewTextTab, openTextInTab } from '../document/open-text';
import { endingsOf } from './endings';
import styles from './folder-search-view.module.css';

/** A place where the pattern was found, as `find_in_folder` gives it. */
interface Match {
  readonly line: number;
  readonly text: string;
  readonly from: number;
  readonly to: number;
}

interface FileMatches {
  readonly path: string;
  readonly under: string;
  readonly count: number;
  readonly matches: readonly Match[];
}

interface Found {
  readonly files: readonly FileMatches[];
  readonly searched: number;
  readonly skipped: number;
  readonly stopped: boolean;
}

/** How replacing went in one file. */
interface Written {
  readonly path: string;
  readonly changed: number;
  readonly problem: string | null;
}

const FLAGS = ['regex', 'caseSensitive', 'wholeWord', 'keepCase'] as const;
type Flags = Readonly<Record<(typeof FLAGS)[number], boolean>>;
const FOLDER_KEY = 'searchFolder';
const ENDINGS_KEY = 'searchEndings';
/** The most matches of one file shown at once; the rest are a click away in the file itself. */
const SHOWN_PER_FILE = 40;

/** A line with the match in it marked. Positions count characters, not the units JavaScript counts in. */
function MatchLine({ match }: { match: Match }) {
  const letters = [...match.text];
  return (
    <span className={styles.lineText}>
      {letters.slice(0, match.from).join('')}
      <mark>{letters.slice(match.from, match.to).join('')}</mark>
      {letters.slice(match.to).join('')}
    </span>
  );
}

/**
 * Find and replace in a folder: every match is shown first, file by file;
 * replacing writes only the files that stay ticked, each in the encoding and
 * with the line endings it had.
 */
export function FolderSearchView({ host }: AppViewProps) {
  const { t } = useI18n();
  const { invoke } = host;
  const [folder, setFolder] = useState(() => host.loadData<string>(FOLDER_KEY) ?? '');
  const [find, setFind] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [flags, setFlags] = useState<Flags>({ regex: false, caseSensitive: false, wholeWord: false, keepCase: false });
  const [endings, setEndings] = useState(() => host.loadData<string>(ENDINGS_KEY) ?? '');
  const [everything, setEverything] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  /** The files that replacing will write: all that were found, until the user unticks some. */
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ key: string; detail?: string } | null>(null);
  /** Asked once more before files are written. */
  const [confirming, setConfirming] = useState(false);
  const [written, setWritten] = useState<readonly Written[] | null>(null);

  const replacement = { find, with: replaceWith, ...flags };

  const chooseFolder = async () => {
    const picked = await host.pickFolder();
    if (picked === null) return;
    setFolder(picked);
    host.saveData(FOLDER_KEY, picked);
  };

  const fail = (error: unknown, fallback: string) => {
    const code = error instanceof AppInvokeError ? error.code : null;
    if (code === 'bad-pattern') setProblem({ key: 'scribe.tools.badPattern', detail: error instanceof Error ? error.message.replace(/^bad-pattern:\s*/, '') : undefined });
    else setProblem({ key: code === 'cannot-open' ? 'scribe.folder.cannotRead' : fallback });
  };

  const search = async (keepWritten = false) => {
    setBusy(true);
    setProblem(null);
    setConfirming(false);
    if (!keepWritten) setWritten(null);
    host.saveData(ENDINGS_KEY, endings);
    try {
      const answer = await invoke<Found>('find_in_folder', { folder, replacement, endings: endingsOf(endings), everything });
      setFound(answer);
      setChosen(new Set(answer.files.map((file) => file.path)));
      // The first few files are open, so something is seen at once.
      setOpened(new Set(answer.files.slice(0, 3).map((file) => file.path)));
    } catch (error) {
      setFound(null);
      fail(error, 'scribe.folder.failed');
    } finally {
      setBusy(false);
    }
  };

  const replaceAll = async () => {
    setBusy(true);
    setProblem(null);
    setConfirming(false);
    try {
      const answer = await invoke<{ files: Written[] }>('replace_in_files', { paths: [...chosen], replacement });
      setWritten(answer.files);
      await search(true);
    } catch (error) {
      fail(error, 'scribe.folder.failed');
      setBusy(false);
    }
  };

  const toggle = (set: ReadonlySet<string>, path: string) => {
    const next = new Set(set);
    if (!next.delete(path)) next.add(path);
    return next;
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
        // This tab is that place already.
        onFindInFolder: () => {},
        onClose: () => host.closeTab(),
        onSettings: host.openSettings,
      }),
    // `host` changes when the tab moves to the back; what it opens does not.
    [host.openTab, host.closeTab, host.openSettings, host.pickFiles, t],
  );
  useTabCommands(host, commands);

  const total = found?.files.reduce((sum, file) => sum + file.count, 0) ?? 0;
  const chosenPlaces = found?.files.filter((file) => chosen.has(file.path)).reduce((sum, file) => sum + file.count, 0) ?? 0;
  const ready = folder !== '' && find !== '' && !busy;
  const done = written?.filter((file) => file.problem === null && file.changed > 0) ?? [];
  const failed = written?.filter((file) => file.problem !== null) ?? [];

  return (
    <div className={styles.view}>
      <form
        className={styles.top}
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) void search();
        }}
      >
        <div className={styles.row}>
          <span className={styles.label}>{t('scribe.folder.folder')}</span>
          <bdi className={styles.folder} dir="ltr" title={folder}>
            {folder === '' ? t('scribe.folder.noFolder') : folder}
          </bdi>
          <Button variant={folder === '' ? 'primary' : undefined} disabled={busy} onClick={() => void chooseFolder()}>
            <Icon name="folder-open" size={14} />
            {t('scribe.folder.choose')}
          </Button>
        </div>
        <div className={styles.fields}>
          <label className={styles.field}>
            <span className={styles.label}>{t('scribe.field.find')}</span>
            <input type="text" className={styles.control} dir="auto" spellCheck={false} value={find} disabled={busy} onChange={(event) => setFind(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>{t('scribe.field.with')}</span>
            <input type="text" className={styles.control} dir="auto" spellCheck={false} value={replaceWith} disabled={busy} onChange={(event) => setReplaceWith(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>{t('scribe.folder.endings')}</span>
            <input type="text" className={styles.control} dir="ltr" spellCheck={false} value={endings} placeholder={t('scribe.folder.endingsHint')} disabled={busy} onChange={(event) => setEndings(event.target.value)} />
          </label>
        </div>
        <div className={styles.row}>
          {FLAGS.map((name) => (
            <label key={name} className={styles.flag}>
              <input type="checkbox" checked={flags[name]} disabled={busy} onChange={(event) => setFlags((current) => ({ ...current, [name]: event.target.checked }))} />
              {t(`scribe.field.${name}`)}
            </label>
          ))}
          <label className={styles.flag}>
            <input type="checkbox" checked={everything} disabled={busy} onChange={(event) => setEverything(event.target.checked)} />
            {t('scribe.folder.everything')}
          </label>
          <span className={styles.spring} />
          <Button type="submit" variant="primary" disabled={!ready}>
            <Icon name="magnifying-glass" size={14} />
            {t(busy ? 'scribe.tools.working' : 'scribe.folder.search')}
          </Button>
        </div>
      </form>

      {problem && (
        <p className={styles.problem} role="alert">
          {t(problem.key)}
          {problem.detail && <bdi dir="ltr"> {problem.detail}</bdi>}
        </p>
      )}

      {written && (
        <div className={styles.written} role="status">
          <p>{t('scribe.folder.written', { files: done.length, places: done.reduce((sum, file) => sum + file.changed, 0) })}</p>
          {failed.length > 0 && (
            <ul>
              {failed.map((file) => (
                <li key={file.path}>
                  <bdi>{fileName(file.path)}</bdi>: {t(`scribe.folder.problem.${file.problem}`)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {found && (
        <div className={styles.summary}>
          <span role="status">
            {total === 0 ? t('scribe.folder.nothing', { searched: found.searched }) : t('scribe.folder.found', { places: total, files: found.files.length, searched: found.searched })}
            {found.skipped > 0 && ` ${t('scribe.folder.skipped', { count: found.skipped })}`}
            {found.stopped && ` ${t('scribe.folder.stopped')}`}
          </span>
          <span className={styles.spring} />
          {total > 0 &&
            (confirming ? (
              <>
                <span className={styles.warning}>{t('scribe.folder.confirm', { files: chosen.size, places: chosenPlaces })}</span>
                <Button onClick={() => setConfirming(false)}>{t('common.action.cancel')}</Button>
                <Button variant="primary" disabled={busy} onClick={() => void replaceAll()}>
                  {t('scribe.folder.write')}
                </Button>
              </>
            ) : (
              <Button disabled={busy || chosen.size === 0} onClick={() => setConfirming(true)}>
                {t('scribe.folder.replace', { files: chosen.size })}
              </Button>
            ))}
        </div>
      )}

      {found && found.files.length > 0 && (
        <ul className={styles.files}>
          {found.files.map((file) => {
            const open = opened.has(file.path);
            return (
              <li key={file.path} className={styles.file}>
                <div className={styles.fileHead}>
                  <input type="checkbox" checked={chosen.has(file.path)} aria-label={t('scribe.folder.include', { name: fileName(file.path) })} onChange={() => setChosen((current) => toggle(current, file.path))} />
                  <button type="button" className={styles.fileName} aria-expanded={open} onClick={() => setOpened((current) => toggle(current, file.path))}>
                    <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
                    <bdi dir="ltr">
                      {file.under !== '' && <span className={styles.under}>{file.under}/</span>}
                      {fileName(file.path)}
                    </bdi>
                    <span className={styles.count}>{t('scribe.folder.places', { count: file.count })}</span>
                  </button>
                  <Button variant="ghost" onClick={() => openTextInTab(host, file.path)}>
                    {t('scribe.compare.openInEditor')}
                  </Button>
                </div>
                {open && (
                  <ol className={styles.matches}>
                    {file.matches.slice(0, SHOWN_PER_FILE).map((match, index) => (
                      <li key={index}>
                        <button type="button" className={styles.match} onClick={() => openTextInTab(host, file.path, match.line)}>
                          <span className={styles.lineNumber}>{match.line}</span>
                          <MatchLine match={match} />
                        </button>
                      </li>
                    ))}
                    {file.count > SHOWN_PER_FILE && <li className={styles.more}>{t('scribe.folder.more', { count: file.count - Math.min(file.matches.length, SHOWN_PER_FILE) })}</li>}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!found && !problem && <p className={styles.message}>{t('scribe.folder.lead')}</p>}
    </div>
  );
}
