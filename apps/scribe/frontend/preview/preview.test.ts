import { describe, expect, it } from 'vitest';
import en from '../../locales/en.json';
import { factsOf, touchedLines } from './preview';
import type { Preview } from './preview';

const texts: Record<string, string> = en;
const nothing: Preview = { text: '', kind: 'same', linesBefore: 0, linesAfter: 0, charactersBefore: 0, charactersAfter: 0, changedLines: 0, movedLines: 0, addedLines: 0, removedLines: 0, marks: [], removed: [] };

describe('what a tool would do', () => {
  it('is said in the facts that are not nothing, each with a name that is written', () => {
    expect(factsOf(nothing)).toEqual([]);
    const facts = factsOf({ ...nothing, movedLines: 3, removedLines: 1 });
    expect(facts).toEqual([
      { key: 'moved', count: 3 },
      { key: 'removed', count: 1 },
    ]);
    for (const key of ['changed', 'moved', 'added', 'removed']) expect(texts[`scribe.preview.fact.${key}`], key).toBeTruthy();
    for (const kind of ['same', 'reordered', 'inPlace', 'removed', 'rewritten']) expect(texts[`scribe.preview.kind.${kind}`], kind).toBeTruthy();
  });

  it('marks in the text the lines changed where they stand and the lines taken out', () => {
    const replaced: Preview = { ...nothing, kind: 'inPlace', marks: [{ kind: 'changed', line: 2, pieces: [[0, 3]] }] };
    expect(touchedLines(replaced)).toEqual({ changed: [2], removed: [] });
    const deduped: Preview = { ...nothing, kind: 'removed', removed: [{ line: 3, text: 'a' }], marks: [{ kind: 'moved', line: 0, from: 2 }] };
    expect(touchedLines(deduped)).toEqual({ changed: [], removed: [2] });
    // In a text compared as two texts, a changed line of the result is not that line of the text.
    const rewritten: Preview = { ...nothing, kind: 'rewritten', marks: [{ kind: 'changed', line: 0, pieces: [] }], removed: [{ line: 2, text: 'b' }] };
    expect(touchedLines(rewritten)).toEqual({ changed: [], removed: [1] });
  });
});
