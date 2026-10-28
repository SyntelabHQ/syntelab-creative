import type { AppHost } from '@syntelab/shell-api';
import type { ToolValues } from './tool-definitions';

/** What a tool is applied to: the selection when there is one, else the whole text. */
export interface ToolTarget {
  readonly text: string;
  /** True when it is the selection. */
  readonly selection: boolean;
  /** Where it starts in the whole text: 0 unless it is the selection. */
  readonly from: number;
}

export interface ToolsPanelProps {
  readonly host: Pick<AppHost, 'invoke' | 'loadData' | 'saveData' | 'readWebPage'>;
  /** The tool whose choices are open; null when none is. */
  readonly openTool: string | null;
  readonly onOpenTool: (id: string | null) => void;
  /** Choices made for a tool from outside the panel (a variant chosen in a menu): taken each time `nonce` changes. */
  readonly preset: { readonly tool: string; readonly values: ToolValues; readonly nonce: number } | null;
  /** Gives what a tool would be applied to right now. */
  readonly target: () => ToolTarget;
  /** How many characters are selected: said on the button, so it is clear what will change. */
  readonly selected: number;
  /** Puts the result in place of what the tool was applied to, as one step that can be undone. */
  readonly onApply: (text: string) => void;
  /** Hears of every tool that was applied, with its choices: what a recipe can be made of. */
  readonly onApplied: (tool: string, values: ToolValues, before: string, after: string) => void;
  /** Puts a text a tool wrote where the cursor is, in place of the selection when there is one. */
  readonly onInsert: (text: string) => void;
  /** Writes a word in place of the one at a place in the whole text; false when another word is there by now. */
  readonly onReplaceAt: (from: number, to: number, text: string) => boolean;
  /** Hears which tool is open with choices it can be applied with (its operation), or that none is: what a result can be shown of beforehand. */
  readonly onPreview: (of: OpenTool | null) => void;
  /** Opens what a text was and what a tool made of it in a tab that compares them. */
  readonly onCompare: (before: string, after: string) => void;
  /** Marks places in the whole text (what "Replace everywhere" would change); none takes the marks away. */
  readonly onMark: (places: readonly { readonly from: number; readonly to: number }[]) => void;
  readonly disabled: boolean;
}

/**
 * The tool that is open, as the rest of the tab needs to know it: with the operation it would do, or with why it
 * has none to show yet — it writes a text instead of changing one (`writes`), or still needs a choice (`choices`).
 */
export type OpenTool = { readonly id: string; readonly operations: readonly Record<string, unknown>[] } | { readonly id: string; readonly waits: 'writes' | 'choices' };
