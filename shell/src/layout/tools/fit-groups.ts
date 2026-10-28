/**
 * How a group of a tool's bar is drawn. `full`: its buttons, each with its
 * icon above its name. `folded`: one button that opens the group's commands
 * in a small window.
 */
export type GroupSize = 'full' | 'folded';

/**
 * Chooses a size for every group of a tool's bar (by its full width) so that
 * they fit the width: while they do not, groups fold, starting from the end.
 * A group that is narrower open than folded stays open.
 */
export function fitGroups(widths: readonly number[], foldedWidth: number, available: number): GroupSize[] {
  const sizes: GroupSize[] = widths.map(() => 'full');
  const widthOf = (index: number): number => {
    const width = widths[index] ?? 0;
    return sizes[index] === 'full' ? width : Math.min(foldedWidth, width);
  };
  const total = () => widths.reduce((sum, _, index) => sum + widthOf(index), 0);
  for (let index = widths.length - 1; index >= 0 && total() > available; index--) sizes[index] = 'folded';
  return sizes;
}
