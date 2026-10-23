/**
 * How a ribbon group is drawn. `full`: large buttons with their names.
 * `compact`: small buttons, still with their names, three above each other.
 * `icons`: icon buttons without names, in one row (the ribbon's compact
 * form, chosen by the user). `folded`: one button that opens the group's
 * commands in a small window.
 */
export type GroupSize = 'full' | 'compact' | 'icons' | 'folded';

export interface GroupWidths {
  readonly full: number;
  readonly compact: number;
}

/**
 * Chooses a size for every group of a ribbon so that they fit the width, the
 * way the ribbon of an office program gives way while its window gets
 * narrower: first groups become compact, starting from the end; when all are
 * compact and it is still too wide, they fold, again starting from the end.
 */
export function fitGroups(groups: readonly GroupWidths[], foldedWidth: number, available: number): GroupSize[] {
  const sizes: ('full' | 'compact' | 'folded')[] = groups.map(() => 'full');
  const widthOf = (index: number): number => {
    const group = groups[index];
    if (!group) return 0;
    if (sizes[index] === 'full') return group.full;
    // A step down never makes a group wider.
    if (sizes[index] === 'compact') return Math.min(group.compact, group.full);
    return Math.min(foldedWidth, group.compact, group.full);
  };
  const total = () => groups.reduce((sum, _, index) => sum + widthOf(index), 0);

  for (const size of ['compact', 'folded'] as const) {
    for (let index = groups.length - 1; index >= 0 && total() > available; index--) {
      sizes[index] = size;
    }
  }
  return sizes;
}

/**
 * The same for a ribbon the user keeps as icons: every group is a row of
 * icons, and those that do not fit fold, starting from the end.
 */
export function fitIconGroups(widths: readonly number[], foldedWidth: number, available: number): GroupSize[] {
  const sizes: GroupSize[] = widths.map(() => 'icons');
  const widthOf = (index: number) => (sizes[index] === 'icons' ? (widths[index] ?? 0) : Math.min(foldedWidth, widths[index] ?? 0));
  const total = () => widths.reduce((sum, _, index) => sum + widthOf(index), 0);
  for (let index = widths.length - 1; index >= 0 && total() > available; index--) sizes[index] = 'folded';
  return sizes;
}
