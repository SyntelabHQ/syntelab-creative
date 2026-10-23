import { EditorState, RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, lineNumbers } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { editorTheme } from '@syntelab/text-editor';
import type { PreviewMark } from './preview';
import styles from './result-view.module.css';

export interface ResultViewProps {
  /** The result, with `\n` between its lines. */
  readonly text: string;
  readonly marks: readonly PreviewMark[];
  readonly wrap: boolean;
  readonly lineNumbers: boolean;
  /** Hears what scrolls the result, and null when it is gone: so it can be scrolled together with the text. */
  readonly onScroller?: (scroller: HTMLElement | null) => void;
}

const LINE = { changed: Decoration.line({ class: 'cm-resultChanged' }), moved: Decoration.line({ class: 'cm-resultMoved' }), added: Decoration.line({ class: 'cm-resultAdded' }) };
const piece = Decoration.mark({ class: 'cm-resultPiece' });

/** The marks as the editor draws them: a colour on each line that differs, and on the stretches that changed inside it. */
function decorationsOf(state: EditorState, marks: readonly PreviewMark[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const mark of [...marks].sort((one, other) => one.line - other.line)) {
    if (mark.line + 1 > state.doc.lines) continue;
    const line = state.doc.line(mark.line + 1);
    builder.add(line.from, line.from, LINE[mark.kind]);
    if (mark.kind !== 'changed') continue;
    for (const [from, to] of mark.pieces) {
      if (from < to && line.from + to <= line.to) builder.add(line.from + from, line.from + to, piece);
    }
  }
  return builder.finish();
}

/**
 * The result of a tool, shown as a text is but not to be changed: the same
 * editor as the text's, so a long result is as light as a long text, with
 * the lines that differ marked.
 */
export function ResultView({ text, marks, wrap, lineNumbers: numbered, onScroller }: ResultViewProps) {
  const parent = useRef<HTMLDivElement>(null);
  const latestOnScroller = useRef(onScroller);
  latestOnScroller.current = onScroller;

  // Made anew for each result: a result is shown, never edited.
  useEffect(() => {
    if (!parent.current) return;
    const shown = EditorState.create({ doc: text });
    const state = EditorState.create({
      doc: shown.doc,
      extensions: [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        // Each line is written in the direction of its own letters.
        EditorView.perLineTextDirection.of(true),
        wrap ? EditorView.lineWrapping : [],
        numbered ? lineNumbers() : [],
        editorTheme,
        EditorView.decorations.of(decorationsOf(shown, marks)),
      ],
    });
    const view = new EditorView({ parent: parent.current, state });
    latestOnScroller.current?.(view.scrollDOM);
    return () => {
      latestOnScroller.current?.(null);
      view.destroy();
    };
  }, [text, marks, wrap, numbered]);

  return <div ref={parent} className={styles.result} />;
}
