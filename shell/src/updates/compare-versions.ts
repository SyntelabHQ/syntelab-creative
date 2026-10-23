/** `1.4.0` → [1, 4, 0]. A part that is not a number counts as 0. */
function parts(version: string): number[] {
  // Anything after "-" or "+" (pre-release, build) does not take part.
  const core = version.trim().replace(/^v/i, '').split(/[-+]/)[0] ?? '';
  return core.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

/** Negative when `a` is older than `b`, positive when newer, 0 when the same. */
export function compareVersions(a: string, b: string): number {
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
