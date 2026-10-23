import { defaultKeymap, history, historyField, historyKeymap, indentWithTab, redo, selectAll, undo } from '@codemirror/commands';
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import { crosshairCursor, drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder, rectangularSelection } from '@codemirror/view';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { editorTheme } from './editor-theme';
import { lineMarks, matchMarks, setLineMarks, setMarks } from './match-marks';
import { syntaxOf } from './syntax';
import type { Syntax } from './syntax';
import type { LineMarks } from './match-marks';
import styles from './text-editor.module.css';

/** What the editor says of itself after every change of the text or of the selection. */
export interface EditorFacts {
  /** The text was changed by the user since it was loaded (or since `markSaved`). */
  readonly changed: boolean;
  /** Where the cursor is, from 1. */
  readonly line: number;
  readonly column: number;
  /** How many characters are selected. */
  readonly selected: number;
  /** How many characters and lines the text has. */
  readonly length: number;
  readonly lines: number;
}

/** A stretch of the text, by the places of its first character and of the one after its last. */
export interface TextRange {
  readonly from: number;
  readonly to: number;
}

/** What the rest of the app does with the editor. */
export interface TextEditorHandle {
  /** The whole text, with `\n` between its lines. */
  text(): string;
  /** What is selected: the stretch and its text; an empty stretch at the cursor when nothing is. */
  selection(): TextRange & { readonly text: string };
  /** Puts `text` in place of a stretch (or of everything), as one step that can be undone. */
  replace(text: string, range?: TextRange): void;
  /** Puts `text` in place of everything without a step to undo: what a pane only shows (the result of a tool). */
  show(text: string): void;
  /** Puts `text` in place of a stretch and shows the place, with the cursor after it: nothing stays selected. */
  replaceAt(text: string, range: TextRange): void;
  /** From here on, "changed" means changed since this moment (the text was just saved). */
  markSaved(): void;
  undo(): void;
  redo(): void;
  selectAll(): void;
  /** Marks places in the text (what a tool would change); none takes the marks away. */
  mark(places: readonly TextRange[]): void;
  /** Marks whole lines of the text (from 0): those a tool would change, and those it would take out. */
  markLines(lines: LineMarks): void;
  /** What scrolls the text: to be scrolled together with another pane. Null before the editor is there. */
  scroller(): HTMLElement | null;
  /** The line (from 0) a place of the text is on. */
  lineOf(position: number): number;
  /** The editor as it is now, with its history of changes: what `initialState` takes, so another tab can go on from here. */
  snapshot(): unknown;
  /** Opens the strip that finds and replaces in the text. */
  openSearch(): void;
  /** Puts the cursor at the start of a line (from 1) and brings it into view. */
  goToLine(line: number): void;
  /** Puts the cursor at a place of the text (from 0) and brings it into view. */
  goTo(position: number): void;
  focus(): void;
}

export interface TextEditorProps {
  /** The text the editor starts with. Later changes of this value are not followed: the editor owns the text. */
  readonly initialText: string;
  /** What `snapshot` gave in another tab: the editor starts from there, history included, in place of `initialText`. */
  readonly initialState?: unknown;
  /** The line (from 1) the editor starts at, in view and with the cursor on it: a match found in a folder. */
  readonly initialLine?: number;
  readonly wrap: boolean;
  readonly lineNumbers: boolean;
  /** The text can be read, selected and copied, and not changed by the user. Taken when the editor is made. */
  readonly readOnly?: boolean;
  /** The text is code of this language, and is coloured as such. */
  readonly syntax?: Syntax;
  /** Keys the editor leaves to the program, by the names CodeMirror gives them (`Mod-Enter`): a command of the program has them. Taken when the editor is made. */
  readonly passKeys?: readonly string[];
  /** The words of the editor's own strips (find and replace), by their English: see `editor-phrases.ts`. */
  readonly phrases: Readonly<Record<string, string>>;
  /** What an empty text says of itself, already translated. Taken when the editor is made. */
  readonly emptyHint?: string;
  readonly onFacts: (facts: EditorFacts) => void;
  /** Told after every change of the text itself, whoever made it. */
  readonly onChange?: () => void;
}

function factsOf(state: EditorState, changed: boolean): EditorFacts {
  const { main } = state.selection;
  const line = state.doc.lineAt(main.head);
  const selected = state.selection.ranges.reduce((sum, range) => sum + (range.to - range.from), 0);
  return { changed, line: line.number, column: main.head - line.from + 1, selected, length: state.doc.length, lines: state.doc.lines };
}

/**
 * The editor: the text, written and changed in place. Built on CodeMirror,
 * which holds long texts without slowing down, writes right to left where a
 * line asks for it, and undoes step by step.
 */
export const TextEditor = forwardRef<TextEditorHandle, TextEditorProps>(function TextEditor({ initialText, initialState, initialLine, emptyHint, wrap, lineNumbers: numbered, readOnly, syntax, passKeys, phrases, onFacts, onChange }, ref) {
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const changed = useRef(false);
  const latestOnFacts = useRef(onFacts);
  latestOnFacts.current = onFacts;
  const latestOnChange = useRef(onChange);
  latestOnChange.current = onChange;
  // What can change while the editor lives, each in a slot of its own.
  const slots = useRef({ wrap: new Compartment(), numbers: new Compartment(), phrases: new Compartment(), syntax: new Compartment() });

  useEffect(() => {
    if (!parent.current) return;
    const { wrap: wrapSlot, numbers, phrases: phraseSlot } = slots.current;
    const extensions = [
          history(),
          readOnly ? EditorState.readOnly.of(true) : [],
          slots.current.syntax.of(syntaxOf(syntax)),
          emptyHint ? placeholder(emptyHint) : [],
          matchMarks,
          lineMarks,
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          // Each line is written in the direction of its own letters: Arabic and Hebrew lines among Latin ones.
          EditorView.perLineTextDirection.of(true),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab].filter((binding) => !passKeys?.includes(binding.key ?? ''))),
          wrapSlot.of(wrap ? EditorView.lineWrapping : []),
          numbers.of(numbered ? [lineNumbers(), highlightActiveLineGutter()] : []),
          phraseSlot.of(EditorState.phrases.of(phrases)),
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              changed.current = true;
              latestOnChange.current?.();
            }
            if (update.docChanged || update.selectionSet) latestOnFacts.current(factsOf(update.state, changed.current));
          }),
        ];
    let state: EditorState | null = null;
    if (initialState !== undefined) {
      try {
        state = EditorState.fromJSON(initialState, { extensions }, { history: historyField });
      } catch {
        // Not a state this editor wrote: the text is started with instead.
        state = null;
      }
    }
    const created = new EditorView({ parent: parent.current, state: state ?? EditorState.create({ doc: initialText, extensions }) });
    view.current = created;
    // Asked to start at a line: said here, where the editor is made, so it holds however many times it is made.
    if (initialLine !== undefined) {
      const at = created.state.doc.line(Math.min(Math.max(Math.round(initialLine), 1), created.state.doc.lines)).from;
      created.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }) });
      created.focus();
    }
    latestOnFacts.current(factsOf(created.state, false));
    return () => {
      created.destroy();
      view.current = null;
    };
    // Made once: the editor owns the text from then on.
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: slots.current.wrap.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap]);
  useEffect(() => {
    view.current?.dispatch({ effects: slots.current.numbers.reconfigure(numbered ? [lineNumbers(), highlightActiveLineGutter()] : []) });
  }, [numbered]);
  useEffect(() => {
    view.current?.dispatch({ effects: slots.current.syntax.reconfigure(syntaxOf(syntax)) });
  }, [syntax]);
  useEffect(() => {
    view.current?.dispatch({ effects: slots.current.phrases.reconfigure(EditorState.phrases.of(phrases)) });
  }, [phrases]);

  useImperativeHandle(
    ref,
    () => ({
      text: () => view.current?.state.doc.toString() ?? '',
      selection: () => {
        const state = view.current?.state;
        if (!state) return { from: 0, to: 0, text: '' };
        const { from, to } = state.selection.main;
        return { from, to, text: state.sliceDoc(from, to) };
      },
      replace: (text, range) => {
        const editor = view.current;
        if (!editor) return;
        const { from, to } = range ?? { from: 0, to: editor.state.doc.length };
        // What was put in stays selected when a stretch was asked for, so the next tool acts on the same stretch.
        editor.dispatch({ changes: { from, to, insert: text }, selection: range ? { anchor: from, head: from + text.length } : undefined, userEvent: 'input.tool' });
      },
      show: (text) => {
        const editor = view.current;
        if (!editor) return;
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text }, annotations: Transaction.addToHistory.of(false) });
      },
      replaceAt: (text, range) => {
        const at = range.from + text.length;
        view.current?.dispatch({ changes: { from: range.from, to: range.to, insert: text }, selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'nearest' }), userEvent: 'input.tool' });
      },
      mark: (places) => view.current?.dispatch({ effects: setMarks.of(places) }),
      markLines: (lines) => view.current?.dispatch({ effects: setLineMarks.of(lines) }),
      scroller: () => view.current?.scrollDOM ?? null,
      lineOf: (position) => {
        const doc = view.current?.state.doc;
        return doc ? doc.lineAt(Math.min(Math.max(position, 0), doc.length)).number - 1 : 0;
      },
      snapshot: () => view.current?.state.toJSON({ history: historyField }),
      markSaved: () => {
        changed.current = false;
        if (view.current) latestOnFacts.current(factsOf(view.current.state, false));
      },
      undo: () => void (view.current && undo(view.current)),
      redo: () => void (view.current && redo(view.current)),
      selectAll: () => void (view.current && selectAll(view.current)),
      openSearch: () => void (view.current && openSearchPanel(view.current)),
      goToLine: (line) => {
        const editor = view.current;
        if (!editor) return;
        const at = editor.state.doc.line(Math.min(Math.max(Math.round(line), 1), editor.state.doc.lines)).from;
        editor.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }) });
        editor.focus();
      },
      goTo: (position) => {
        const editor = view.current;
        if (!editor) return;
        const at = Math.min(Math.max(Math.round(position), 0), editor.state.doc.length);
        editor.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }) });
        editor.focus();
      },
      focus: () => view.current?.focus(),
    }),
    [],
  );

  return <div ref={parent} className={styles.editor} />;
});
