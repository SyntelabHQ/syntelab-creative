import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';

/**
 * The places a tool would change, marked in the text before it is applied
 * (what "Replace everywhere" finds, while it is being written).
 */

/** A place in the text, by its first character and the one after its last. */
interface Place {
  readonly from: number;
  readonly to: number;
}

const mark = Decoration.mark({ class: 'cm-toolMatch' });
const changedLine = Decoration.line({ class: 'cm-toolChangedLine' });
const removedLine = Decoration.line({ class: 'cm-toolRemovedLine' });

/** The lines of the text (from 0) a tool would change where they stand, and those it would take out. */
export interface LineMarks {
  readonly changed: readonly number[];
  readonly removed: readonly number[];
}

/** Marks these lines, in place of the ones marked before. */
export const setLineMarks = StateEffect.define<LineMarks>();

/** The marked lines; they go as soon as the text changes, since they are of the text as it was. */
export const lineMarks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setLineMarks)) continue;
      const lines = transaction.newDoc.lines;
      const wanted = [...effect.value.changed.map((line) => ({ line, mark: changedLine })), ...effect.value.removed.map((line) => ({ line, mark: removedLine }))].filter((one) => one.line >= 0 && one.line < lines).sort((one, other) => one.line - other.line);
      return Decoration.set(
        wanted.map((one) => one.mark.range(transaction.newDoc.line(one.line + 1).from)),
        true,
      );
    }
    return transaction.docChanged ? Decoration.none : marks;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Marks these places, in place of the ones marked before; none takes the marks away. */
export const setMarks = StateEffect.define<readonly Place[]>();

/** The marks, kept where their text goes while the text around them changes. */
export const matchMarks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setMarks)) continue;
      const length = transaction.newDoc.length;
      // In order and inside the text: what the editor asks of a set of marks.
      const places = effect.value.filter((place) => place.from < place.to && place.to <= length).sort((one, other) => one.from - other.from);
      return Decoration.set(places.map((place) => mark.range(place.from, place.to)));
    }
    return transaction.docChanged ? marks.map(transaction.changes) : marks;
  },
  provide: (field) => EditorView.decorations.from(field),
});
