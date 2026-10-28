import { useI18n } from '@syntelab/i18n';
import { AppInvokeError } from '@syntelab/shell-api';
import { useEffect, useRef, useState } from 'react';
import type { Doubt, Doubts } from '../doubtful-words';
import { initialValues, isReady, operationOf, TOOLS } from '../tool-definitions';
import type { Tool, ToolValues } from '../tool-definitions';
import type { ToolsPanelProps } from '../tool-panel-types';

/** What the last tool did, said under its button. */
export type ToolResult = { readonly kind: 'done'; readonly changed: number } | { readonly kind: 'made' } | { readonly kind: 'problem'; readonly key: string; readonly detail?: string };

/** How long after the last key the matches of "find" are counted again. */
const COUNT_AFTER = 300;
/** Above this many characters matches are counted only when the tool is applied: the text is sent to be counted at every change. */
const COUNT_UP_TO = 2_000_000;
/** How many of the matches are marked in the text: the rest are only counted. */
const MOST_MARKED = 5000;

/**
 * What the panel of tools does, apart from how it is laid out: the choices of
 * each tool as the user left them, the tool applied to the text, the places a
 * find-and-replace would change counted while it is written, and the rest of
 * the tab told which tool is open.
 *
 * It says the same things as `tools-panel.tsx` does for itself. The two are
 * kept apart while the owner chooses between the two panels; the one that
 * stays keeps this, the other goes.
 */
export function useToolRunner({ host, openTool, preset, target, selected, onApply, onApplied, onInsert, onMark, onPreview }: Pick<ToolsPanelProps, 'host' | 'openTool' | 'preset' | 'target' | 'selected' | 'onApply' | 'onApplied' | 'onInsert' | 'onMark' | 'onPreview'>) {
  const { language } = useI18n();
  const { invoke } = host;
  /** The choices of each tool, as the user left them. */
  const [values, setValues] = useState<Readonly<Record<string, ToolValues>>>({});
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<ToolResult | null>(null);
  /** How many places "find" matches now; null while unknown. On how many lines they are, and how many different texts. */
  const [matches, setMatches] = useState<number | null>(null);
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

  const valuesOf = (tool: Tool): ToolValues => values[tool.id] ?? initialValues(tool);
  const replaceValues = values.replace;

  // What one tool said is not said of the next.
  useEffect(() => {
    setResult(null);
    setLast(null);
    setDoubts(null);
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

  return { valuesOf, setToolValues: (tool: Tool, next: ToolValues) => setValues((current) => ({ ...current, [tool.id]: next })), working, result, matches, matchFacts, last, doubts, apply };
}
