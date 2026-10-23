import type { AppHost } from '@syntelab/shell-api';

/** One of the two texts to compare: a file, or a text that is in an editor (handed over with its name). */
export type CompareSide = { readonly path: string } | { readonly name: string; readonly text: string } | null;

let compareCount = 0;
/** Texts handed to compare tabs that are about to open, by the tab's key. Kept in memory only. */
const handedOver = new Map<string, { left: CompareSide; right: CompareSide; typing: boolean }>();

/** Opens a tab that compares two texts. A side left out is chosen in the tab, or, with `typing`, typed or pasted there. */
export function openCompareTab(host: Pick<AppHost, 'openTab'>, title: string, left: CompareSide = null, right: CompareSide = null, typing = false): void {
  compareCount += 1;
  const key = `compare:${Date.now()}:${compareCount}`;
  handedOver.set(key, { left, right, typing });
  host.openTab({ key, title, params: { compare: key } });
}

/** How long what was handed over is kept after it is first asked for: a tab asks more than once while it starts. */
const KEPT_FOR = 10_000;

/** The key of a compare tab opened from the search of the Start page: nothing handed over, the two texts typed or pasted. */
const TYPED_COMPARE = 'typed';

/** What a compare tab was opened with. It is forgotten a moment after the tab first asks, so long texts do not stay in memory. */
export function takeCompareSides(key: string): { left: CompareSide; right: CompareSide; typing: boolean } {
  const sides = handedOver.get(key);
  if (!sides) return { left: null, right: null, typing: key === TYPED_COMPARE };
  setTimeout(() => handedOver.delete(key), KEPT_FOR);
  return sides;
}
