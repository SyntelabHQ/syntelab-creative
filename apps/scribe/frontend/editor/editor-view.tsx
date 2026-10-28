import { useI18n } from '@syntelab/i18n';
import { fileEnding, fileName, useTabCommands } from '@syntelab/shell-api';
import type { AppViewProps } from '@syntelab/shell-api';
import { Icon, IconButton } from '@syntelab/ui-kit';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { editorCommands, toolMenu } from '../commands';
import { openCompareTab } from '../compare/open-compare';
import { countWords } from '../document/count-words';
import { openFolderSearchTab, openLargeFileTab, openNewTextTab, openSavedTextInTab, openTextInTab, takeAskedLine, takeHandedEditor, takeHandover } from '../document/open-text';
import { rememberText } from '../document/recent-texts';
import { ReopenDialog } from '../document/reopen-dialog';
import { documentFormat, saveTypes } from '../document/save-types';
import { touchedLines } from '../preview/preview';
import { ResultPane } from '../preview/result-pane';
import { usePreview } from '../preview/use-preview';
import type { PreviewOf } from '../preview/use-preview';
import type { PreviewState } from '../preview/result-pane';
import { fileProblem, isTooLarge, newFileForm, openText, saveText } from '../document/text-file';
import type { FileForm } from '../document/text-file';
import { changeSettings, DEFAULT_SETTINGS, NARROWEST_PANEL, SMALLEST_SHARE, useScribeSettings, WIDEST_PANEL } from '../settings/scribe-settings';
import { ScribeStart } from '../start/scribe-start';
import { StatusBar } from '../status/status-bar';
import { PaneHead } from '../panel/pane-head';
import { PANEL_PARTS, PanelRail, SidePanel } from '../panel/side-panel';
import type { PanelPart } from '../panel/side-panel';
import { Splitter } from '../panel/splitter';
import type { RecipeStep } from '../recipes/recipe-store';
import { RecipesPanel } from '../recipes/recipes-panel';
import { StatsPanel } from '../stats/stats-panel';
import { sameWord } from '../tools/doubtful-words';
import { toolById } from '../tools/tool-definitions';
import type { ToolValues } from '../tools/tool-definitions';
import { ToolsPagesPanel } from '../tools/pages/tools-pages-panel';
import type { OpenTool } from '../tools/tool-panel-types';
import styles from './editor-view.module.css';
import { editorPhrases, TextEditor } from '@syntelab/text-editor';
import type { EditorFacts, TextEditorHandle } from '@syntelab/text-editor';

export interface EditorViewProps extends AppViewProps {
  /** The file the tab shows; undefined for a text that has no file yet. */
  readonly path?: string;
  /** The file is to be opened whole although it is larger than the editor takes by itself: the user asked for it. */
  readonly whole?: boolean;
  /** The key of a new text's tab: a text handed over to it waits under this key. */
  readonly untitled?: string;
  /**
   * What the tab is opened for, from the search of the Start page: a tool (its id) beside a new text, or `count` for
   * what the text is made of. The opening page of Scribe is then passed over.
   */
  readonly tool?: string;
}

/** What is said in the strip above the text: a problem, or something worth knowing. */
interface Said {
  readonly kind: 'problem' | 'notice';
  readonly key: string;
  readonly values?: Readonly<Record<string, string>>;
}

const NO_FACTS: EditorFacts = { changed: false, line: 1, column: 1, selected: 0, length: 0, lines: 1 };
/** Words are counted a moment after the typing stops; a long text waits a little longer. */
const COUNT_AFTER = 250;
const LONG_TEXT = 1_500_000;
const COUNT_LONG_AFTER = 1200;

/**
 * One tab of Scribe: a text in the editor, the line under it, and the
 * commands that open, save and change it.
 */
export function EditorView({ host, path, untitled, whole = false, tool }: EditorViewProps) {
  const { t, language } = useI18n();
  const settings = useScribeSettings(host);
  const editor = useRef<TextEditorHandle>(null);
  /** The text the editor starts with; null while the file is read. A new number makes a new editor (the file read again). */
  const [loaded, setLoaded] = useState<{ text: string; generation: number; state?: unknown; line?: number } | null>(null);
  const [form, setForm] = useState<FileForm>(() => newFileForm(settings));
  /** The encoding or the line endings were changed: the file is not as the text says until it is saved. */
  const [formChanged, setFormChanged] = useState(false);
  const [facts, setFacts] = useState<EditorFacts>(NO_FACTS);
  const [words, setWords] = useState<number | null>(0);
  const [encodings, setEncodings] = useState<readonly string[]>(['UTF-8']);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);
  const [failed, setFailed] = useState(false);
  const [reopening, setReopening] = useState(false);
  /** The name a new text is offered to be saved under, when it came with one (a file dropped on the window). */
  const [givenName, setGivenName] = useState<string | undefined>(undefined);
  /** The tools applied to this text since it was opened: what a recipe can be made of. */
  const [applied, setApplied] = useState<readonly RecipeStep[]>([]);
  /** What a result is shown of beforehand: the open tool with its choices; null when none can be applied as it is. */
  const [openState, setOpenState] = useState<OpenTool | null>(null);
  /** What the last tool was applied to, with which choices, and what it gave: the result pane says so, and offers the way back. */
  const [lastApplied, setLastApplied] = useState<{ readonly tool: string; readonly choices: string; readonly before: string; readonly after: string } | null>(null);
  /** Scribe was opened, not a text: what can be done is shown to be chosen, until something is. */
  const [choosing, setChoosing] = useState(path === undefined && untitled === undefined);
  /** Choices made for a tool from a menu (one of its variants): handed to the panel. */
  const [preset, setPreset] = useState<{ readonly tool: string; readonly values: ToolValues; readonly nonce: number } | null>(null);
  /** The tool whose choices are open in the panel. */
  const [openTool, setOpenTool] = useState<string | null>(null);
  const { invoke, setUnsavedChanges } = host;
  // The panel beside the text: the parts the user wants of it, and the one in front. With none, there is no panel.
  const parts = settings.panelParts;
  const part: PanelPart | undefined = parts.includes(settings.sidePanel) ? settings.sidePanel : parts[0];
  /** Shows a part of the panel and brings it to the front, unfolding the panel when it was folded away. */
  const showPart = (shown: PanelPart) => changeSettings(host, { panelParts: PANEL_PARTS.filter((known) => known === shown || parts.includes(known)), sidePanel: shown, toolsShown: true });
  /** A part is there or it is not: asked for while it is in sight, it goes; while the panel is folded away, it is brought back. */
  const togglePart = (toggled: PanelPart) => (parts.includes(toggled) && settings.toolsShown ? changeSettings(host, { panelParts: parts.filter((known) => known !== toggled) }) : showPart(toggled));
  const { showTool, setIdleBar } = host;
  /**
   * Opens a tool in the panel (or closes the one that is open), with the bar of its group above the text. A tool that
   * changes the text brings its result into view.
   */
  const openToolById = (id: string | null) => {
    setOpenTool(id);
    const toolGroup = id === null ? undefined : toolById(id)?.group;
    if (toolGroup) showTool(toolMenu(toolGroup));
    if (id !== null && toolById(id)?.makes !== true && !settings.previewShown) changeSettings(host, { previewShown: true });
  };
  const changed = facts.changed || formChanged;

  const load = useCallback(
    async (encoding?: string) => {
      if (path === undefined) return;
      setBusy(true);
      setSaid(null);
      try {
        const opened = await openText({ invoke }, path, encoding, whole);
        setForm({ encoding: opened.encoding, mark: opened.mark, lineEnding: opened.lineEnding });
        setFormChanged(false);
        setFailed(false);
        // A line asked for before the file was read (a match found in a folder) is where the editor starts.
        const line = takeAskedLine(path);
        setLoaded((before) => ({ text: opened.text, generation: (before?.generation ?? 0) + 1, line }));
        rememberText(host, path);
        if (opened.damaged) setSaid({ kind: 'problem', key: 'scribe.problem.damaged', values: { encoding: opened.encoding } });
        else if (opened.mixedEndings) setSaid({ kind: 'notice', key: 'scribe.notice.mixedEndings' });
      } catch (error) {
        if (isTooLarge(error)) {
          // Too large to hold whole: it is shown a page at a time, in a tab made for that.
          openLargeFileTab(host, path);
          return host.closeTab({ discardChanges: true });
        }
        setFailed(true);
        setSaid({ kind: 'problem', ...fileProblem(error, 'scribe.problem.cannotOpen') });
      } finally {
        setBusy(false);
      }
    },
    // `host` changes when the tab moves to the back; where it keeps its data does not.
    [invoke, path],
  );

  useEffect(() => {
    if (path !== undefined) {
      // Just saved under this name from another tab: the editor goes on from where that one was.
      const saved = takeHandedEditor(path);
      if (!saved) return void load();
      setForm(saved.form);
      rememberText(host, path);
      return setLoaded({ text: '', state: saved.state, generation: 1 });
    }
    const handed = untitled ? takeHandover(untitled) : { text: '' };
    if (handed.form) setForm(handed.form);
    setGivenName(handed.name);
    setLoaded({ text: handed.text, generation: 1 });
    // A tab keeps its file for as long as it lives.
  }, []);

  useEffect(() => {
    let cancelled = false;
    invoke<{ encodings: string[] }>('encodings', {}).then((answer) => !cancelled && setEncodings(answer.encodings), () => {});
    return () => {
      cancelled = true;
    };
  }, [invoke]);

  // Asked to show a line (a match found in a folder): when the text is there, and each time the tab comes to the front.
  useEffect(() => {
    if (!host.active || loaded === null || path === undefined) return;
    const line = takeAskedLine(path);
    if (line !== undefined) editor.current?.goToLine(line);
  }, [host.active, loaded, path]);

  // While the text has changes that are not in its file, closing the tab asks first.
  useEffect(() => setUnsavedChanges(changed), [setUnsavedChanges, changed]);

  // The words are counted a moment after the last change, not at every key.
  useEffect(() => {
    if (!loaded) return;
    setWords(null);
    const wait = setTimeout(() => setWords(countWords(editor.current?.text() ?? '', language)), facts.length > LONG_TEXT ? COUNT_LONG_AFTER : COUNT_AFTER);
    return () => clearTimeout(wait);
  }, [facts.length, facts.changed, loaded, language]);

  const write = async (destination: string): Promise<boolean> => {
    setBusy(true);
    setSaid(null);
    try {
      await saveText({ invoke }, destination, editor.current?.text() ?? '', form);
      return true;
    } catch (error) {
      setSaid({ kind: 'problem', ...fileProblem(error, 'scribe.problem.cannotSave') });
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** Writes the text as a Word document or a PDF: a copy for others; the text keeps its own file. */
  const writeDocument = async (destination: string, format: 'docx' | 'pdf') => {
    setBusy(true);
    setSaid(null);
    try {
      await invoke('export_text', { path: destination, text: editor.current?.text() ?? '', format });
      setSaid({ kind: 'notice', key: 'scribe.file.exported', values: { name: fileName(destination) } });
    } catch (error) {
      setSaid({ kind: 'problem', ...fileProblem(error, 'scribe.problem.cannotSave') });
    } finally {
      setBusy(false);
    }
  };

  const saveAs = async () => {
    const ending = fileEnding(path ?? givenName ?? '') || 'txt';
    const destination = await host.pickSavePath({
      typeName: t('scribe.file.type'),
      extension: ending,
      suggestedName: path ? fileName(path) : (givenName ?? `${t('scribe.file.newName')}.txt`),
      types: saveTypes(ending, (id) => t(`scribe.file.saveType.${id}`)),
    });
    if (destination === null) return;
    const format = documentFormat(destination);
    if (format) return writeDocument(destination, format);
    if (!(await write(destination))) return;
    rememberText(host, destination);
    if (destination === path) {
      editor.current?.markSaved();
      return setFormChanged(false);
    }
    // The saved file takes this tab's place: it is now the text, with the history of this one.
    openSavedTextInTab(host, destination, { state: editor.current?.snapshot(), form });
    host.closeTab({ discardChanges: true });
  };

  const save = async () => {
    if (path === undefined) return saveAs();
    if (!(await write(path))) return;
    editor.current?.markSaved();
    setFormChanged(false);
  };

  const open = async () => {
    const picked = await host.pickFiles({ typeName: t('scribe.file.anyType'), extensions: ['*'], multiple: true });
    for (const chosen of picked) openTextInTab(host, chosen);
    // An empty new text was only waiting for something to open.
    if (picked.length > 0 && path === undefined && !changed && facts.length === 0) host.closeTab();
  };

  /** Compares the text as it is now, saved or not, with a file the user chooses. */
  const compareWithFile = async () => {
    const [picked] = await host.pickFiles({ typeName: t('scribe.file.anyType'), extensions: ['*'] });
    if (picked) openCompareTab(host, t('scribe.compare.title'), { name: path ? fileName(path) : t('scribe.compare.thisText'), text: editor.current?.text() ?? '' }, { path: picked });
  };

  // What the commands call is always these functions as they are now.
  const latest = useRef({ save, saveAs, open, compareWithFile });
  latest.current = { save, saveAs, open, compareWithFile };

  const commands = useMemo(
    () =>
      editorCommands({
        onNew: () => openNewTextTab(host, t('scribe.file.untitled')),
        onOpen: () => void latest.current.open(),
        onSave: () => void latest.current.save(),
        onSaveAs: () => void latest.current.saveAs(),
        onReopen: () => setReopening(true),
        onClose: () => host.closeTab(),
        onSettings: host.openSettings,
        onUndo: () => editor.current?.undo(),
        onRedo: () => editor.current?.redo(),
        onFind: () => editor.current?.openSearch(),
        onSelectAll: () => editor.current?.selectAll(),
        onWrap: () => changeSettings(host, { wrap: !settings.wrap }),
        onLineNumbers: () => changeSettings(host, { lineNumbers: !settings.lineNumbers }),
        // Asked for on the opening page (Statistics, Recipes in the list on the side): the text comes, with that part beside it.
        onPart: (asked) => {
          if (!choosing) return togglePart(asked);
          setChoosing(false);
          showPart(asked);
        },
        onPreview: () => changeSettings(host, { previewShown: !settings.previewShown }),
        onCompareWithFile: () => void latest.current.compareWithFile(),
        onCompareFiles: () => openCompareTab(host, t('scribe.compare.title')),
        onFindInFolder: () => openFolderSearchTab(host, t('scribe.folder.title')),
        onCompareWithText: () => openCompareTab(host, t('scribe.compare.title'), { name: path ? fileName(path) : t('scribe.compare.thisText'), text: editor.current?.text() ?? '' }, null, true),
        onCompareTexts: () => openCompareTab(host, t('scribe.compare.title'), null, null, true),
        // A tool asked for (on a bar, in the search) opens in the panel, wherever that was hidden, with the bar of its group above the text.
        onTool: (id, chosen) => {
          setChoosing(false);
          changeSettings(host, { panelParts: PANEL_PARTS.filter((known) => known === 'tools' || parts.includes(known)), sidePanel: 'tools', toolsShown: true });
          if (chosen) setPreset((before) => ({ tool: id, values: chosen, nonce: (before?.nonce ?? 0) + 1 }));
          openToolById(id);
        },
        changed,
        hasFile: path !== undefined,
        busy: busy || loaded === null,
        wrap: settings.wrap,
        lineNumbers: settings.lineNumbers,
        panelParts: parts,
        previewShown: settings.previewShown,
        openTool,
      }),
    // `host` changes when the tab moves to the back; what it opens does not.
    [host.openTab, host.closeTab, host.openSettings, t, changed, path, busy, loaded === null, settings.wrap, settings.lineNumbers, settings.toolsShown, settings.previewShown, settings.panelParts, settings.sidePanel, openTool, choosing],
  );
  // The first page of Scribe ("What would you like to do?"). In no menu of its own: "Go to Start" of the File menu,
  // which the shell puts there, runs it (the shell looks for a command named `<app-id>.start`). The text of the tab stays as it is.
  const withStart = useMemo(() => [...commands, { id: 'scribe.start', labelKey: 'scribe.command.start', icon: 'house', run: () => setChoosing(true) }], [commands]);
  useTabCommands(host, withStart);

  const phrases = useMemo(() => editorPhrases(t), [t]);

  /** What a tool or a count works on: the selection when there is one, else the whole text. */
  const target = () => {
    const chosen = editor.current?.selection();
    return chosen && chosen.to > chosen.from ? { text: chosen.text, selection: true, from: chosen.from } : { text: editor.current?.text() ?? '', selection: false, from: 0 };
  };
  // What the open tool would give, kept up to date while the text and its choices change.
  // The result pane is there whenever its switch is on (View → Result beside the text), with or without a result.
  const previewed: PreviewOf | null = settings.previewShown && openState && 'operations' in openState ? { id: openState.id, title: '', operations: openState.operations } : null;
  const preview = usePreview(host, previewed, () => target().text, facts);
  /**
   * The open tool was just applied, with the choices it still has, and the text is still what it gave. The pane says
   * so until the text or a choice changes, instead of showing at once what applying it a second time would give:
   * lines just put in reverse would be shown put back, as if nothing had been done.
   */
  const justApplied = openState !== null && 'operations' in openState && lastApplied !== null && lastApplied.tool === openState.id && lastApplied.choices === JSON.stringify(openState.operations) && lastApplied.after === target().text;
  /** What the pane shows: a result, or why there is none to show. */
  const paneState = ((): PreviewState => {
    if (!openState) return { kind: 'hint', why: 'noTool' };
    if ('waits' in openState) return { kind: 'hint', why: openState.waits };
    if (justApplied) return { kind: 'applied' };
    if (facts.length === 0) return { kind: 'hint', why: 'empty' };
    if (preview === null) return { kind: 'working' };
    if (preview.kind !== 'ready' || preview.preview.kind !== 'same') return preview;
    return { kind: 'hint', why: 'same' };
  })();
  // The lines it would change or take out are marked in the text itself too.
  const previewResult = previewed && !justApplied && preview?.kind === 'ready' ? preview.preview : null;
  useEffect(() => {
    if (!previewResult) return editor.current?.markLines({ changed: [], removed: [] });
    const chosen = editor.current?.selection();
    const first = chosen && chosen.to > chosen.from ? (editor.current?.lineOf(chosen.from) ?? 0) : 0;
    const touched = touchedLines(previewResult);
    editor.current?.markLines({ changed: touched.changed.map((line) => line + first), removed: touched.removed.map((line) => line + first) });
    // Marked again for each result; the marks go by themselves when the text changes.
  }, [previewResult]);

  // The text and the result scroll as one, so the same lines stay side by side.
  const [resultScroller, setResultScroller] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const textScroller = editor.current?.scroller();
    if (!textScroller || !resultScroller || !settings.scrollTogether) return;
    // The result starts where the text is, not at its top.
    resultScroller.scrollTop = textScroller.scrollTop;
    let leading: HTMLElement | null = null;
    const follow = (from: HTMLElement, to: HTMLElement) => () => {
      // What is being scrolled by the other is not what leads.
      if (leading !== null && leading !== from) return;
      leading = from;
      to.scrollTop = from.scrollTop;
      to.scrollLeft = from.scrollLeft;
      requestAnimationFrame(() => {
        leading = null;
      });
    };
    const fromText = follow(textScroller, resultScroller);
    const fromResult = follow(resultScroller, textScroller);
    textScroller.addEventListener('scroll', fromText, { passive: true });
    resultScroller.addEventListener('scroll', fromResult, { passive: true });
    return () => {
      textScroller.removeEventListener('scroll', fromText);
      resultScroller.removeEventListener('scroll', fromResult);
    };
  }, [resultScroller, settings.scrollTogether, loaded?.generation]);

  /** Opens two texts in a tab that compares them: what was, and what a tool makes of it. */
  const compareTexts = (before: string, after: string) => openCompareTab(host, t('scribe.compare.title'), { name: t('scribe.preview.before'), text: before }, { name: t('scribe.preview.after'), text: after });

  /** Puts a tool's result in place of what it worked on, as one step that can be undone. */
  const putBack = (text: string) => {
    const chosen = editor.current?.selection();
    editor.current?.replace(text, chosen && chosen.to > chosen.from ? { from: chosen.from, to: chosen.to } : undefined);
  };

  /** Puts a text a tool wrote where the cursor is, in place of the selection when there is one. */
  const insert = (text: string) => {
    const chosen = editor.current?.selection();
    if (chosen) editor.current?.replace(text, { from: chosen.from, to: chosen.to });
  };

  /** Writes a word in place of the one at a place, when that one is still the same word but for its diacritics. */
  const replaceAt = (from: number, to: number, text: string) => {
    const there = (editor.current?.text() ?? '').slice(from, to);
    if (there.length !== text.length || !sameWord(there, text)) return false;
    editor.current?.replaceAt(text, { from, to });
    return true;
  };

  /** A tool chosen on the opening page: its bar over an empty text, or a tab of its own (two texts compared). */
  const chooseTool = (menuKey: string) => {
    if (menuKey === toolMenu('compare')) return openCompareTab(host, t('scribe.compare.title'), null, null, true);
    if (menuKey === toolMenu('stats')) showPart('stats');
    else if (menuKey === toolMenu('recipes')) showPart('recipes');
    else showTool(menuKey);
    setChoosing(false);
    // The text is where the typing goes from here.
    setTimeout(() => editor.current?.focus(), 0);
  };

  // A tool chosen in the list on the side while the opening page is shown: the text comes, with the tool's bar.
  const askedBar = host.tool;
  useEffect(() => {
    if (askedBar !== null && choosing) setChoosing(false);
  }, [askedBar]);
  // The bar of another group (or none, after Done): the tool open in the panel was of the one before, and is put away.
  const shownBar = useRef(askedBar);
  useEffect(() => {
    if (shownBar.current === askedBar) return;
    shownBar.current = askedBar;
    setOpenTool((current) => (current !== null && toolMenu(toolById(current)?.group ?? '') !== askedBar ? null : current));
  }, [askedBar]);

  // While the text is shown with no tool's bar, the tools used most stand over it.
  const working = loaded !== null && !choosing;
  useEffect(() => {
    setIdleBar(working);
    return () => setIdleBar(false);
  }, [working, setIdleBar]);

  // Opened for a tool (the search of the Start page): it is opened as soon as the text is there, once.
  const askedTool = useRef(tool);
  useEffect(() => {
    const asked = askedTool.current;
    if (loaded === null || asked === undefined) return;
    askedTool.current = undefined;
    if (asked === 'count') showPart('stats');
    else if (toolById(asked)) {
      showPart('tools');
      openToolById(asked);
    } else return;
    setChoosing(false);
    setTimeout(() => editor.current?.focus(), 0);
    // Only the text being there counts: the tool is asked for once.
  }, [loaded]);

  /** The text and a result are shown together: two panes, each with its head. */
  // Two panes whenever the result is switched on: what the switch says is what is seen.
  const dual = settings.previewShown;

  return (
    <div className={styles.view} data-font={settings.font} style={{ fontSize: settings.fontSize }}>
      {said && (
        <div className={styles.said} data-kind={said.kind} role={said.kind === 'problem' ? 'alert' : 'status'}>
          <Icon name={said.kind === 'problem' ? 'triangle-exclamation' : 'circle-info'} size={16} />
          <span className={styles.saidText}>{t(said.key, said.values)}</span>
          <IconButton variant="ghost" aria-label={t('scribe.said.dismiss')} tooltipSide="bottom-end" onClick={() => setSaid(null)}>
            <Icon name="xmark" size={14} />
          </IconButton>
        </div>
      )}
      {loaded === null && !failed && (
        <p className={styles.waiting} role="status">
          {t('scribe.file.reading')}
        </p>
      )}
      {loaded !== null && choosing && (
        <ScribeStart
          host={host}
          onChoose={chooseTool}
          onNewText={() => {
            setChoosing(false);
            setTimeout(() => editor.current?.focus(), 0);
          }}
          onOpen={() => void latest.current.open()}
          onFindInFolder={() => openFolderSearchTab(host, t('scribe.folder.title'))}
          onOpenRecent={(recent) => {
            openTextInTab(host, recent);
            // This tab was only waiting for something to be chosen.
            host.closeTab();
          }}
        />
      )}
      {loaded !== null && (
        <div className={styles.work} hidden={choosing}>
          <div className={styles.panes} data-stacked={settings.previewStacked} data-dual={dual}>
            <div className={styles.pane} style={dual ? { flex: `0 1 ${settings.previewShare * 100}%` } : undefined}>
              {dual && (
                <PaneHead
                  title={t('scribe.pane.text')}
                  of={path ? fileName(path) : (givenName ?? t('scribe.pane.unsaved'))}
                  actions={[
                    { id: 'undo', icon: 'arrow-rotate-left', label: t('scribe.command.undo'), onRun: () => editor.current?.undo() },
                    { id: 'redo', icon: 'arrow-rotate-right', label: t('scribe.command.redo'), onRun: () => editor.current?.redo() },
                    { id: 'copy', icon: 'copy', label: t('scribe.pane.copyText'), disabled: facts.length === 0, onRun: () => void navigator.clipboard.writeText(target().text) },
                    { id: 'paste', icon: 'paste', minor: true, label: t('scribe.pane.pasteOver'), onRun: () => void navigator.clipboard.readText().then((pasted) => pasted !== '' && putBack(pasted), () => {}) },
                    { id: 'all', icon: 'check-double', minor: true, label: t('scribe.command.selectAll'), disabled: facts.length === 0, onRun: () => editor.current?.selectAll() },
                    { id: 'clear', icon: 'eraser', minor: true, label: t('scribe.pane.clear'), disabled: facts.length === 0, onRun: () => putBack('') },
                  ]}
                  facts={
                    <span className={styles.fact}>
                      {facts.selected > 0 ? `${t('scribe.status.selected', { count: facts.selected })} · ` : ''}
                      {t('scribe.status.lines', { count: facts.lines })} · {words === null ? t('scribe.status.counting') : t('scribe.status.words', { count: words })} · {t('scribe.status.characters', { count: facts.length })}
                    </span>
                  }
                />
              )}
              <TextEditor key={loaded.generation} ref={editor} initialText={loaded.text} initialState={loaded.state} initialLine={loaded.line} wrap={settings.wrap} lineNumbers={settings.lineNumbers} phrases={phrases} emptyHint={t('scribe.editor.empty')} onFacts={setFacts} />
            </div>
            {dual && (
              <>
                <Splitter
                  orientation={settings.previewStacked ? 'horizontal' : 'vertical'}
                  label={t('scribe.pane.drag')}
                  onMove={(share) => changeSettings(host, { previewShare: Math.min(Math.max(share, SMALLEST_SHARE), 1 - SMALLEST_SHARE) })}
                  onStep={(by) => changeSettings(host, { previewShare: settings.previewShare + by * 0.05 })}
                  onReset={() => changeSettings(host, { previewShare: DEFAULT_SETTINGS.previewShare })}
                />
                <ResultPane
                  title={openState ? t(`scribe.tool.${openState.id}`) : ''}
                  state={paneState}
                  ofSelection={facts.selected > 0}
                  wrap={settings.wrap}
                  lineNumbers={settings.lineNumbers}
                  stacked={settings.previewStacked}
                  scrollTogether={settings.scrollTogether}
                  onShowLine={(line) => {
                    const chosen = editor.current?.selection();
                    const first = chosen && chosen.to > chosen.from ? (editor.current?.lineOf(chosen.from) ?? 0) : 0;
                    // Shown without moving the cursor into it: a selection must stay what the tool works on.
                    if (!(chosen && chosen.to > chosen.from)) editor.current?.goToLine(line + first);
                  }}
                  onCopy={(result) => void navigator.clipboard.writeText(result)}
                  onOpenAsNew={(result) => openNewTextTab(host, t('scribe.file.untitled'), result)}
                  onCompare={(result) => compareTexts(target().text, result)}
                  onStacked={(previewStacked) => changeSettings(host, { previewStacked })}
                  onScrollTogether={(scrollTogether) => changeSettings(host, { scrollTogether })}
                  onScroller={setResultScroller}
                  onUndo={() => editor.current?.undo()}
                  onCompareApplied={() => lastApplied && compareTexts(lastApplied.before, lastApplied.after)}
                  onClose={() => changeSettings(host, { previewShown: false })}
                />
              </>
            )}
          </div>
          {part === undefined ? null : settings.toolsShown ? (
            <>
              <Splitter
                orientation="vertical"
                label={t('scribe.pane.dragPanel')}
                onMove={(_share, pixels, size) => changeSettings(host, { panelWidth: Math.min(Math.max(size - pixels, NARROWEST_PANEL), Math.min(WIDEST_PANEL, size - (dual && !settings.previewStacked ? 342 : 170))) })}
                onStep={(by) => changeSettings(host, { panelWidth: settings.panelWidth - by * 20 })}
                onReset={() => changeSettings(host, { panelWidth: DEFAULT_SETTINGS.panelWidth })}
              />
              <SidePanel part={part} parts={parts} width={settings.panelWidth} onCollapse={() => changeSettings(host, { toolsShown: false })} onPartChange={(sidePanel) => changeSettings(host, { sidePanel })}>
                {part === 'tools' ? (
                  <ToolsPagesPanel host={host} openTool={openTool} onOpenTool={openToolById} preset={preset} selected={facts.selected} disabled={busy} target={target} onApply={putBack} onInsert={insert} onReplaceAt={replaceAt} onMark={(places) => editor.current?.mark(places)} onPreview={setOpenState} onCompare={compareTexts} onApplied={(tool, values, before, after) => {
                      setApplied((current) => [...current, { tool, values }].slice(-50));
                      setLastApplied(before === after || !openState || !('operations' in openState) ? null : { tool, choices: JSON.stringify(openState.operations), before, after });
                    }} />
                ) : part === 'recipes' ? (
                  <RecipesPanel host={host} applied={applied} onForgetApplied={() => setApplied([])} target={target} onApply={putBack} disabled={busy} />
                ) : (
                  <StatsPanel host={host} target={target} version={facts} length={facts.length} />
                )}
              </SidePanel>
            </>
          ) : (
            <PanelRail part={part} parts={parts} onOpen={(sidePanel) => changeSettings(host, { toolsShown: true, sidePanel })} />
          )}
        </div>
      )}
      {loaded !== null && !choosing && (
        <StatusBar
          facts={facts}
          words={words}
          form={form}
          encodings={encodings}
          disabled={busy}
          onFormChange={(change) => {
            setForm((current) => ({ ...current, ...change }));
            setFormChanged(true);
          }}
        />
      )}
      <ReopenDialog
        open={reopening}
        onClose={() => setReopening(false)}
        current={form.encoding}
        encodings={encodings}
        changed={changed}
        onReopen={(encoding) => {
          setReopening(false);
          void load(encoding);
        }}
      />
    </div>
  );
}
