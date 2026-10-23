import type { AppEntry } from '@syntelab/shell-api';

/**
 * The apps in the order the user gave them. Apps the user never placed (new
 * ones) keep their usual place after the others.
 */
export function orderApps(apps: readonly AppEntry[], order: readonly string[]): AppEntry[] {
  const place = (app: AppEntry) => {
    const index = order.indexOf(app.manifest.id);
    return index === -1 ? order.length : index;
  };
  // Array.sort is stable: apps without a place stay in their usual order.
  return [...apps].sort((a, b) => place(a) - place(b));
}

/**
 * The order after moving one app so that it comes just before the app at
 * `before` (`ids.length` moves it to the end).
 */
export function moveApp(ids: readonly string[], moved: string, before: number): string[] {
  const from = ids.indexOf(moved);
  if (from === -1) return [...ids];
  const rest = ids.filter((id) => id !== moved);
  // Positions after the moved app shift down by one once it is taken out.
  const target = Math.min(Math.max(before > from ? before - 1 : before, 0), rest.length);
  return [...rest.slice(0, target), moved, ...rest.slice(target)];
}
