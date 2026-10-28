import { createDataStore, useDataStore } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';
import { HANDWRITING_WORDS_A_MINUTE, READING_WORDS_A_MINUTE, SPEAKING_WORDS_A_MINUTE, TYPING_WORDS_A_MINUTE } from '../stats/reading-time';

/** The letters the editor writes with: of one width (like a typewriter) or the program's own. */
export const EDITOR_FONTS = ['mono', 'sans'] as const;
export type EditorFont = (typeof EDITOR_FONTS)[number];

/** How the lines of a new text end: as this computer ends them, or always one way. */
export const NEW_LINE_ENDINGS = ['system', 'crlf', 'lf'] as const;
export type NewLineEnding = (typeof NEW_LINE_ENDINGS)[number];

/** The speeds and the size of a page that Statistics reckons with: words a minute, and words on a page. */
export const PACES = ['readingSpeed', 'speakingSpeed', 'typingSpeed', 'handwritingSpeed', 'wordsPerPage'] as const;
export type Pace = (typeof PACES)[number];
export const SLOWEST_PACE = 1;
export const FASTEST_PACE = 2000;

/** The least of the room either of two panes side by side is left with, as a share; and how narrow and how wide the panel can be dragged. */
export const SMALLEST_SHARE = 0.2;
export const NARROWEST_PANEL = 240;
export const WIDEST_PANEL = 640;

export const SMALLEST_FONT_SIZE = 9;
export const LARGEST_FONT_SIZE = 32;

/** The settings of Scribe: they belong to this app only. Kept on this computer. */
export interface ScribeSettings {
  /** Long lines are folded at the edge of the window. */
  readonly wrap: boolean;
  readonly lineNumbers: boolean;
  readonly font: EditorFont;
  /** Height of the letters, in pixels. */
  readonly fontSize: number;
  /** The panel beside the text is shown, and what it shows: the tools, the recipes, or what the text is made of. */
  readonly toolsShown: boolean;
  readonly sidePanel: 'tools' | 'recipes' | 'stats';
  /** What the open tool would give is shown beside the text before it is applied. */
  readonly previewShown: boolean;
  /** The result stands under the text instead of beside it; how much of the room the text takes (0.2 to 0.8); whether the two scroll as one. */
  readonly previewStacked: boolean;
  readonly previewShare: number;
  readonly scrollTogether: boolean;
  /** How wide the panel beside the text is, in pixels. */
  readonly panelWidth: number;
  /** The parts of the panel that are shown (tools, recipes, statistics); with none, there is no panel. */
  readonly panelParts: readonly ('tools' | 'recipes' | 'stats')[];
  /** What a new text is saved as: how its lines end, and whether its file starts with a byte order mark. */
  readonly newLineEnding: NewLineEnding;
  readonly newMark: boolean;
  /** Words a minute: read in silence, said aloud, typed, written by hand. */
  readonly readingSpeed: number;
  readonly speakingSpeed: number;
  readonly typingSpeed: number;
  readonly handwritingSpeed: number;
  /** Words on a page, for how many pages a text makes. */
  readonly wordsPerPage: number;
}

/** The settings the Settings page shows, in its order: each can be put back as the program ships it. */
export const SETTING_KEYS = ['font', 'fontSize', 'wrap', 'lineNumbers', 'previewShown', 'newLineEnding', 'newMark', ...PACES] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export const DEFAULT_SETTINGS: ScribeSettings = { wrap: true, lineNumbers: true, font: 'mono', fontSize: 14, toolsShown: true, sidePanel: 'tools', previewShown: true, previewStacked: false, previewShare: 0.5, scrollTogether: true, panelWidth: 320, panelParts: ['tools', 'recipes', 'stats'], newLineEnding: 'system', newMark: false, readingSpeed: READING_WORDS_A_MINUTE, speakingSpeed: SPEAKING_WORDS_A_MINUTE, typingSpeed: TYPING_WORDS_A_MINUTE, handwritingSpeed: HANDWRITING_WORDS_A_MINUTE, wordsPerPage: 300 };

/** Settings as stored, made whole: what is missing or not valid (any more) is as the program ships it. */
export function readSettings(stored: unknown): ScribeSettings {
  if (typeof stored !== 'object' || stored === null) return DEFAULT_SETTINGS;
  const values = stored as Record<string, unknown>;
  const flag = (key: 'wrap' | 'lineNumbers' | 'toolsShown' | 'newMark' | 'previewShown' | 'previewStacked' | 'scrollTogether') => (typeof values[key] === 'boolean' ? (values[key] as boolean) : DEFAULT_SETTINGS[key]);
  const size = typeof values.fontSize === 'number' && Number.isFinite(values.fontSize) ? Math.round(values.fontSize) : DEFAULT_SETTINGS.fontSize;
  const pace = (key: Pace) => (typeof values[key] === 'number' && Number.isFinite(values[key]) ? Math.min(Math.max(Math.round(values[key] as number), SLOWEST_PACE), FASTEST_PACE) : DEFAULT_SETTINGS[key]);
  return {
    wrap: flag('wrap'),
    lineNumbers: flag('lineNumbers'),
    toolsShown: flag('toolsShown'),
    previewShown: flag('previewShown'),
    panelParts: Array.isArray(values.panelParts) ? (['tools', 'recipes', 'stats'] as const).filter((part) => (values.panelParts as unknown[]).includes(part)) : DEFAULT_SETTINGS.panelParts,
    previewStacked: flag('previewStacked'),
    scrollTogether: flag('scrollTogether'),
    previewShare: typeof values.previewShare === 'number' && Number.isFinite(values.previewShare) ? Math.min(Math.max(values.previewShare, SMALLEST_SHARE), 1 - SMALLEST_SHARE) : DEFAULT_SETTINGS.previewShare,
    panelWidth: typeof values.panelWidth === 'number' && Number.isFinite(values.panelWidth) ? Math.min(Math.max(Math.round(values.panelWidth), NARROWEST_PANEL), WIDEST_PANEL) : DEFAULT_SETTINGS.panelWidth,
    sidePanel: values.sidePanel === 'stats' || values.sidePanel === 'recipes' ? values.sidePanel : 'tools',
    font: EDITOR_FONTS.includes(values.font as EditorFont) ? (values.font as EditorFont) : DEFAULT_SETTINGS.font,
    fontSize: Math.min(Math.max(size, SMALLEST_FONT_SIZE), LARGEST_FONT_SIZE),
    newLineEnding: NEW_LINE_ENDINGS.includes(values.newLineEnding as NewLineEnding) ? (values.newLineEnding as NewLineEnding) : DEFAULT_SETTINGS.newLineEnding,
    newMark: flag('newMark'),
    readingSpeed: pace('readingSpeed'),
    speakingSpeed: pace('speakingSpeed'),
    typingSpeed: pace('typingSpeed'),
    handwritingSpeed: pace('handwritingSpeed'),
    wordsPerPage: pace('wordsPerPage'),
  };
}

const store = createDataStore('settings', readSettings);

/** Changes some settings, from what they are at that moment. */
export function changeSettings(host: Pick<AppHost, 'loadData' | 'saveData'>, change: Partial<ScribeSettings>): void {
  store.save(host, readSettings({ ...store.load(host), ...change }));
}

/** The settings, kept up to date while they are changed elsewhere. */
export function useScribeSettings(host: Pick<AppHost, 'loadData'>): ScribeSettings {
  return useDataStore(store, host);
}
