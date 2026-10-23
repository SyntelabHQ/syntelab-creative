/** A value with the steps that led to it, for undo and redo. */
export interface History<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
}

/** Steps further back than this are forgotten. */
const MAX_STEPS = 100;

export function startHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** Makes `next` the present. What could be redone is dropped, as in every editor. */
export function pushHistory<T>(history: History<T>, next: T): History<T> {
  return { past: [...history.past, history.present].slice(-MAX_STEPS), present: next, future: [] };
}

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redo<T>(history: History<T>): History<T> {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future: rest };
}
