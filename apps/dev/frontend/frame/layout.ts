/** How the frame of a tool is laid out: chosen in the View menu and by dragging, the same for every tool, kept between uses. */
export interface ToolLayout {
  /** What goes in and what comes out stand side by side; else one over the other. */
  readonly sideBySide: boolean;
  /** The editors show the number of each line. */
  readonly lineNumbers: boolean;
  /** A line too long for its pane goes on on the next row; else the pane scrolls sideways. */
  readonly wrap: boolean;
  /** How much of the room the first pane takes, from 0 to 1. */
  readonly split: number;
  /** The line between the panes was dragged to a new place. */
  readonly onSplit: (split: number) => void;
}

/** A pane is never dragged smaller than this part of the room, nor the other one. */
const NARROWEST = 0.15;

export const DEFAULT_SPLIT = 0.5;

/** A part of the room as stored, made valid: within what a pane can be dragged to, the middle when it is no number. */
export function readSplit(stored: unknown): number {
  if (typeof stored !== 'number' || !Number.isFinite(stored)) return DEFAULT_SPLIT;
  return Math.min(Math.max(stored, NARROWEST), 1 - NARROWEST);
}
