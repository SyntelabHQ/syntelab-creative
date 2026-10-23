import { useI18n } from '@syntelab/i18n';
import { AppInvokeError } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';
import { Button, Icon } from '@syntelab/ui-kit';
import { useEffect, useRef, useState } from 'react';
import { DoubtfulWords } from './doubtful-words';
import type { Doubt, Doubts } from './doubtful-words';
import { countsOf, initialValues, isReady, operationOf, TOOL_GROUPS, TOOLS } from './tool-definitions';
import type { Tool, ToolValues } from './tool-definitions';
import { ToolFields } from './tool-fields';
import styles from './tools-panel.module.css';

/** What a tool is applied to: the selection when there is one, else the whole text. */
export interface ToolTarget {
  readonly text: string;
  /** True when it is the selection. */
  readonly selection: boolean;
  /** Where it starts in the whole text: 0 unless it is the selection. */
  readonly from: number;
}

export interface ToolsPanelProps {
  readonly host: Pick<AppHost, 'invoke' | 'loadData' | 'saveData' | 'readWebPage'>;
  /** The tool whose choices are open; null when none is. */
  readonly openTool: string | null;
  readonly onOpenTool: (id: string | null) => void;
  /** The groups of tools that are not listed: the user chose not to see them. */
  readonly hiddenGroups: readonly string[];
  /** Choices made for a tool from outside the panel (a variant chosen in a menu): taken each time `nonce` changes. */
  readonly preset: { readonly tool: string; readonly values: ToolValues; readonly nonce: number } | null;
  /** Gives what a tool would be applied to right now. */
  readonly target: () => ToolTarget;
  /** How many characters are selected: said on the button, so it is clear what will change. */
  readonly selected: number;
  /** Puts the result in place of what the tool was applied to, as one step that can be undone. */
  readonly onApply: (text: string) => void;
  /** Hears of every tool that was applied, with its choices: what a recipe can be made of. */
  readonly onApplied: (tool: string, values: ToolValues, before: string, after: string) => void;
  /** Puts a text a tool wrote where the cursor is, in place of the selection when there is one. */
  readonly onInsert: (text: string) => void;
  /** Writes a word in place of the one at a place in the whole text; false when another word is there by now. */
  readonly onReplaceAt: (from: number, to: number, text: string) => boolean;
  /** Hears which tool is open with choices it can be applied with (its operation), or that none is: what a result can be shown of beforehand. */
  readonly onPreview: (of: OpenTool | null) => void;
  /** Opens what a text was and what a tool made of it in a tab that compares them. */
  readonly onCompare: (before: string, after: string) => void;
  /** Marks places in the whole text (what "Replace everywhere" would change); none takes the marks away. */
  readonly onMark: (places: readonly { readonly from: number; readonly to: number }[]) => void;
  readonly disabled: boolean;
}

/**
 * The tool that is open, as the rest of the tab needs to know it: with the operation it would do, or with why it
 * has none to show yet — it writes a text instead of changing one (`writes`), or still needs a choice (`choices`).
 */
export type OpenTool = { readonly id: string; readonly operations: readonly Record<string, unknown>[] } | { readonly id: string; readonly waits: 'writes' | 'choices' };

/** What the last tool did, said under it. */
type Result = { readonly kind: 'done'; readonly changed: number } | { readonly kind: 'made' } | { readonly kind: 'problem'; readonly key: string; readonly detail?: string };

const FOLDED_KEY = 'toolGroupsFolded';
/** How long after the last key the matches of "find" are counted again. */
const COUNT_AFTER = 300;
/** Above this many characters matches are counted only when the tool is applied: the text is sent to be counted at every change. */
const COUNT_UP_TO = 2_000_000;
/** How many of the matches are marked in the text: the rest are only counted. */
const MOST_MARKED = 5000;

/**
 * The tools, in the panel beside the text: grouped by what they work on, each opening to
 * its own choices. A tool is applied to the selection when there is one,
 * else to the whole text, and what it did is one step to undo.
 */
export function ToolsPanel({ host, openTool, onOpenTool, hiddenGroups, preset, target, selected, onApply, onApplied, onInsert, onReplaceAt, onMark, onPreview, onCompare, disabled }: ToolsPanelProps) {
  const { t, language } = useI18n();
  const { invoke } = host;
  /** The choices of each tool, as the user left them. */
  const [values, setValues] = useState<Readonly<Record<string, ToolValues>>>({});
  const [folded, setFolded] = useState<readonly string[]>(() => {
    const stored = host.loadData<unknown>(FOLDED_KEY);
    return Array.isArray(stored) ? stored.filter((group): group is string => typeof group === 'string') : [];
  });
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  /** How many places "find" matches now; null while unknown. */
  const [matches, setMatches] = useState<number | null>(null);
  /** On how many lines they are, and how many different texts they are. */
  const [matchFacts, setMatchFacts] = useState<{ readonly lines: number; readonly different: number } | null>(null);
  /** What the last tool was applied to and what it gave: to be compared afterwards. */
  const [last, setLast] = useState<{ readonly before: string; readonly after: string } | null>(null);
  /** The words the last run left for a person to settle. */
  const [doubts, setDoubts] = useState<Doubts | null>(null);

  // A variant chosen in a menu sets the choice it stands for; the others stay as the user left them.
  useEffect(() => {
    if (!preset) return;
    const tool = TOOLS.find((known) => known.id === preset.tool);
    if (tool) setValues((current) => ({ ...current, [tool.id]: { ...(current[tool.id] ?? initialValues(tool)), ...preset.values } }));
  }, [preset?.nonce]);

  const valuesOf = (tool: Tool) => values[tool.id] ?? initialValues(tool);
  const replaceValues = values.replace;

  const groups = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setResult(null);
    setLast(null);
    setDoubts(null);
    // A tool opened from the menus is brought into view with its choices.
    groups.current?.querySelector('[data-open="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [openTool]);

  // The places a find-and-replace would change are counted while it is being written.
  useEffect(() => {
    setMatches(null);
    if (openTool !== 'replace' || !replaceValues || replaceValues.find === '') return onMark([]);
    let cancelled = false;
    const wait = setTimeout(() => {
      const { text, from } = target();
      if (text.length > COUNT_UP_TO) return onMark([]);
      invoke<{ count: number; lines: number; different: number; places: { from: number; to: number }[] }>('count_matches', { text, replacement: replaceValues, places: MOST_MARKED }).then(
        (answer) => {
          if (cancelled) return;
          setMatches(answer.count);
          setMatchFacts({ lines: answer.lines, different: answer.different });
          onMark(answer.places.map((place) => ({ from: from + place.from, to: from + place.to })));
        },
        () => {
          if (cancelled) return;
          setMatches(null);
          onMark([]);
        },
      );
    }, COUNT_AFTER);
    return () => {
      cancelled = true;
      clearTimeout(wait);
    };
    // Counted again when what is looked for changes, the selection does, or a tool was applied.
  }, [openTool, replaceValues, selected, invoke, result]);

  // The tool that is open, when it can be applied as it is, is what a result is shown of beforehand.
  const openValues = openTool ? values[openTool] : undefined;
  const latestOnPreview = useRef(onPreview);
  latestOnPreview.current = onPreview;
  useEffect(() => {
    const tool = TOOLS.find((known) => known.id === openTool);
    const chosen = tool ? (openValues ?? initialValues(tool)) : {};
    if (!tool) return latestOnPreview.current(null);
    if (tool.makes) return latestOnPreview.current({ id: tool.id, waits: 'writes' });
    latestOnPreview.current(isReady(tool, chosen) ? { id: tool.id, operations: [operationOf(tool, chosen, language)] } : { id: tool.id, waits: 'choices' });
  }, [openTool, openValues, language]);
  useEffect(() => () => latestOnPreview.current(null), []);

  // The marks go with the panel: nothing stays marked when the tools are put away.
  const latestOnMark = useRef(onMark);
  latestOnMark.current = onMark;
  useEffect(() => () => latestOnMark.current([]), []);

  const toggleGroup = (group: string) => {
    // A group is open while one of its tools is, whatever was folded: folding it puts that tool away too.
    const holdsOpenTool = TOOLS.some((known) => known.group === group && known.id === openTool);
    const open = !folded.includes(group) || holdsOpenTool;
    if (open && holdsOpenTool) onOpenTool(null);
    const next = open ? [...folded.filter((known) => known !== group), group] : folded.filter((known) => known !== group);
    setFolded(next);
    host.saveData(FOLDED_KEY, next);
  };

  const apply = async (applied: Tool) => {
    const { text, from } = target();
    setWorking(true);
    setResult(null);
    setDoubts(null);
    try {
      if (applied.online) {
        // The page is fetched by the browser on the computer; what is read of it is found here, as for a source pasted by hand.
        const source = await host.readWebPage(String(valuesOf(applied).address ?? ''));
        const read = await invoke<{ text: string }>('apply', { text: source, operations: [{ kind: 'stripHtml' }, { kind: 'emptyLines', mode: 'collapse' }] });
        if (read.text.trim() === '') return setResult({ kind: 'problem', key: 'scribe.tools.webPage.failed' });
        onInsert(read.text);
        return setResult({ kind: 'made' });
      }
      if (applied.makes) {
        const made = await invoke<{ text: string }>('generate', { generator: operationOf(applied, valuesOf(applied), language) });
        onInsert(made.text);
        return setResult({ kind: 'made' });
      }
      // Romanian diacritics come back with the words that could not be settled, to be shown one by one.
      const answer =
        applied.id === 'restoreRomanian'
          ? await invoke<{ text: string; changed: number; doubtful: Doubt[] }>('restore_romanian', { text, guess: valuesOf(applied).guess === true })
          : await invoke<{ text: string; changed: number; doubtful?: Doubt[] }>('apply', { text, operations: [operationOf(applied, valuesOf(applied), language)] });
      // Nothing to put back when nothing changed: the history keeps no empty step.
      if (answer.text !== text) onApply(answer.text);
      setLast(answer.text !== text ? { before: text, after: answer.text } : null);
      onApplied(applied.id, valuesOf(applied), text, answer.text);
      setResult({ kind: 'done', changed: answer.changed });
      if (answer.doubtful && answer.doubtful.length > 0) setDoubts({ base: from, text: answer.text, words: answer.doubtful });
    } catch (error) {
      // Why a page could not be brought: the shell says it in a word.
      if (applied.online) return setResult({ kind: 'problem', key: `scribe.tools.webPage.${error instanceof Error && ['not-an-address', 'no-browser'].includes(error.message) ? error.message : 'failed'}` });
      const code = error instanceof AppInvokeError ? error.code : null;
      if (code === 'bad-pattern') setResult({ kind: 'problem', key: 'scribe.tools.badPattern', detail: error instanceof Error ? error.message.replace(/^bad-pattern:\s*/, '') : undefined });
      else if (code === 'bad-choice' && applied.makes) setResult({ kind: 'problem', key: 'scribe.tools.tooMuch' });
      else if (code === 'bad-choice' && applied.id === 'replaceMany') setResult({ kind: 'problem', key: 'scribe.tools.badPairs' });
      else setResult({ kind: 'problem', key: 'scribe.tools.failed' });
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className={styles.panel}>
      <p className={styles.scope}>{selected > 0 ? t('scribe.tools.onSelection', { count: selected }) : t('scribe.tools.onAll')}</p>
      {TOOL_GROUPS.every((group) => hiddenGroups.includes(group)) && <p className={styles.scope}>{t('scribe.tools.allHidden')}</p>}
      <div ref={groups} className={styles.groups}>
        {TOOL_GROUPS.filter((group) => !hiddenGroups.includes(group)).map((group) => {
          const open = !folded.includes(group) || TOOLS.some((known) => known.group === group && known.id === openTool);
          return (
            <section key={group} className={styles.group}>
              <button type="button" className={styles.groupName} aria-expanded={open} onClick={() => toggleGroup(group)}>
                <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
                {t(`scribe.toolGroup.${group}`)}
              </button>
              {open &&
                TOOLS.filter((known) => known.group === group).map((known) => {
                  const shown = known.id === openTool;
                  const chosen = valuesOf(known);
                  return (
                    <div key={known.id} className={styles.tool} data-open={shown}>
                      <button type="button" className={styles.toolName} aria-expanded={shown} onClick={() => onOpenTool(shown ? null : known.id)}>
                        <Icon name={known.icon} size={14} />
                        <span>{t(`scribe.tool.${known.id}`)}</span>
                      </button>
                      {shown && (
                        <form
                          className={styles.choices}
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (!disabled && !working && isReady(known, chosen)) void apply(known);
                          }}
                        >
                          <p className={styles.hint}>{t(`scribe.toolHint.${known.id}`)}</p>
                          <ToolFields tool={known} values={chosen} disabled={disabled || working} onChange={(next) => setValues((current) => ({ ...current, [known.id]: next }))} />
                          {known.id === 'replace' && matches !== null && (
                            <p className={styles.count}>
                              {t('scribe.tools.matches', { count: matches })}
                              {matches > 1 && matchFacts && ` ${t('scribe.tools.matchFacts', { lines: matchFacts.lines, different: matchFacts.different })}`}
                            </p>
                          )}
                          <Button type="submit" variant="primary" disabled={disabled || working || !isReady(known, chosen)}>
                            {t(working ? 'scribe.tools.working' : known.online ? 'scribe.tools.bring' : known.makes ? 'scribe.tools.write' : 'scribe.tools.apply')}
                          </Button>
                          {result?.kind === 'done' && !(result.changed === 0 && doubts) && (
                            <p className={styles.done} role="status">
                              {t(result.changed === 0 ? 'scribe.tools.nothingChanged' : `scribe.tools.changed.${countsOf(known)}`, { count: result.changed })}
                            </p>
                          )}
                          {result?.kind === 'done' && last && (
                            <Button onClick={() => onCompare(last.before, last.after)}>
                              <Icon name="code-compare" size={14} />
                              {t('scribe.tools.compareWithBefore')}
                            </Button>
                          )}
                          {doubts && <DoubtfulWords doubts={doubts} onChoose={onReplaceAt} disabled={disabled || working} />}
                          {result?.kind === 'made' && (
                            <p className={styles.done} role="status">
                              {t('scribe.tools.made')}
                            </p>
                          )}
                          {result?.kind === 'problem' && (
                            <p className={styles.problem} role="alert">
                              {t(result.key)}
                              {result.detail && <bdi dir="ltr"> {result.detail}</bdi>}
                            </p>
                          )}
                        </form>
                      )}
                    </div>
                  );
                })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
