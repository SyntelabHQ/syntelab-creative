import type { Outcome } from './use-batch-run';

/** The words of a report, already translated. */
export interface ReportWords {
  readonly title: string;
  /** What was done, written out ("Add page numbers, Sign with a certificate"). */
  readonly done: string;
  readonly folder: string;
  readonly written: string;
  readonly failed: string;
  readonly notReached: string;
  /** What a problem says, from its key. */
  readonly problem: (key: string) => string;
}

/**
 * The report of a run, as text: when, what was done, where to, and for each
 * file what was written or why nothing was. Kept beside the results, for
 * runs too long to read off the screen.
 */
export function reportText(files: readonly string[], outcomes: ReadonlyMap<string, Outcome>, facts: { moment: string; steps: string; folder: string }, words: ReportWords): string {
  const count = (state: Outcome['state']) => files.filter((path) => (outcomes.get(path)?.state ?? 'waiting') === state).length;
  const lines = [`${words.title} — ${facts.moment}`, `${words.done}: ${facts.steps}`, `${words.folder}: ${facts.folder}`, `${words.written}: ${count('done')}    ${words.failed}: ${count('failed')}    ${words.notReached}: ${count('waiting') + count('working')}`, ''];
  for (const path of files) {
    const outcome = outcomes.get(path);
    const said = outcome?.state === 'done' ? `${words.written}: ${outcome.name}` : outcome?.state === 'failed' ? `${words.failed}: ${words.problem(outcome.problem)}` : words.notReached;
    lines.push(path, `    ${said}`);
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** The name of a report's file: told apart from the others of its folder by the moment it was made. */
export function reportName(now: Date): string {
  const two = (number: number) => String(number).padStart(2, '0');
  return `batch-report_${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}_${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}.txt`;
}
