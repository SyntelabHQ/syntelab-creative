/**
 * The widths the columns are drawn with. Those that were given a width keep
 * it; the others share what is left of `room` equally, none narrower than the
 * least its head needs. When the room is not enough they stay at their least
 * and the table is scrolled sideways.
 */
export function sharedWidths(columns: readonly { readonly width: number | null; readonly least: number }[], room: number): number[] {
  const widths = columns.map((column) => column.width);
  let left = room - columns.reduce((sum, column) => sum + (column.width ?? 0), 0);
  let sharing = columns.map((_, at) => at).filter((at) => widths[at] === null);
  // A column whose head needs more than its share takes what it needs; the others share the rest.
  for (;;) {
    const share = sharing.length > 0 ? left / sharing.length : 0;
    const tight = sharing.filter((at) => (columns[at]?.least ?? 0) > share);
    if (tight.length === 0) break;
    for (const at of tight) {
      widths[at] = columns[at]?.least ?? 0;
      left -= widths[at] ?? 0;
    }
    sharing = sharing.filter((at) => !tight.includes(at));
  }
  const share = sharing.length > 0 ? Math.floor(left / sharing.length) : 0;
  sharing.forEach((at, nth) => (widths[at] = nth === sharing.length - 1 ? left - share * (sharing.length - 1) : share));
  return widths.map((width) => Math.max(Math.round(width ?? 0), 1));
}
