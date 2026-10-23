import { useCallback, useState } from 'react';
import { DEFAULT_STYLE } from './mark';
import type { MarkStyle } from './mark';
import type { MarkTool } from './mark-layer';

/** Which mark is selected: on which page (by the page's key), and which one. */
export interface MarkSelection {
  readonly pageKey: string;
  readonly markId: string;
}

export interface Marking {
  /** The tool in use; null when the page is not being drawn on. */
  readonly tool: MarkTool | null;
  /** Starts drawing on the page with a tool, or changes tool; null ends it. */
  setTool(tool: MarkTool | null): void;
  /** What the next mark will look like. */
  readonly style: MarkStyle;
  setStyle(change: Partial<MarkStyle>): void;
  readonly selection: MarkSelection | null;
  select(selection: MarkSelection | null): void;
}

/** The state of drawing on the page, for one open document. */
export function useMarking(): Marking {
  const [tool, setToolState] = useState<MarkTool | null>(null);
  const [style, setStyleState] = useState<MarkStyle>(DEFAULT_STYLE);
  const [selection, select] = useState<MarkSelection | null>(null);

  const setTool = useCallback((next: MarkTool | null) => {
    setToolState(next);
    // Nothing stays selected when the tools are put away.
    if (next === null) select(null);
  }, []);
  const setStyle = useCallback((change: Partial<MarkStyle>) => setStyleState((current) => ({ ...current, ...change })), []);

  return { tool, setTool, style, setStyle, selection, select };
}
