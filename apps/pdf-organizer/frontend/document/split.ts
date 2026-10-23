import type { PlanPage } from './page-plan';

/** How a document is cut into several files. */
export type SplitRule =
  /** A new file every `pages` pages. */
  | { readonly kind: 'every'; readonly pages: number }
  /** A new file starts at each of these pages (indexes from 0). */
  | { readonly kind: 'at'; readonly starts: ReadonlySet<number> };

/** The plan cut into parts, in order. Every page lands in exactly one part. */
export function splitPlan(plan: readonly PlanPage[], rule: SplitRule): PlanPage[][] {
  const parts: PlanPage[][] = [];
  const size = rule.kind === 'every' ? Math.max(1, Math.floor(rule.pages) || 1) : 0;
  plan.forEach((page, index) => {
    const startsPart = rule.kind === 'every' ? index % size === 0 : index === 0 || rule.starts.has(index);
    if (startsPart) parts.push([]);
    parts[parts.length - 1]?.push(page);
  });
  return parts;
}

/** `1` → `01` when there are ten parts or more, so the files sort in order. */
export function partNumber(index: number, partCount: number): string {
  return String(index + 1).padStart(String(partCount).length, '0');
}
