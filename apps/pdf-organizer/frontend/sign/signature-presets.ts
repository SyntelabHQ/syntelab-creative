import type { AppHost } from '@syntelab/shell-api';
import type { LoadedPicture } from '../document/load-picture';

/**
 * How a signature made with a certificate looks where it shows: a picture
 * (a stamp, a handwritten signature) or none, and which lines of text. The
 * user keeps several under names of their own, one for each way they sign
 * (for a company, in their own name…). Kept on this computer only.
 */
export interface SignaturePreset {
  readonly id: string;
  readonly name: string;
  /** The picture at the left of the text, or filling the box when there is no text. */
  readonly picture: LoadedPicture | null;
  /** Which lines are written: who signed, when, why, where. */
  readonly showName: boolean;
  readonly showDate: boolean;
  readonly showReason: boolean;
  readonly showLocation: boolean;
  /** The lines say what they are ("Digitally signed by", "Date:"); off, they are the bare name, date… */
  readonly labels: boolean;
  /** Lines of the user's own, written after the name: a role, a company. */
  readonly extra: string;
}

/** The look that is always there: text alone, who and when. Its name is said in the language of the program. */
export const STANDARD_ID = 'standard';
export const STANDARD_PRESET: SignaturePreset = { id: STANDARD_ID, name: '', picture: null, showName: true, showDate: true, showReason: false, showLocation: false, labels: true, extra: '' };

const PRESETS_KEY = 'signaturePresets';
const LAST_KEY = 'signaturePresetUsed';
const MOST_PRESETS = 20;

function isPreset(value: unknown): value is SignaturePreset {
  if (typeof value !== 'object' || value === null) return false;
  const preset = value as Record<string, unknown>;
  const picture = preset.picture as Record<string, unknown> | null | undefined;
  const pictureFits = picture === null || (typeof picture === 'object' && typeof picture.address === 'string' && picture.address.startsWith('data:image/') && typeof picture.width === 'number' && typeof picture.height === 'number');
  return typeof preset.id === 'string' && preset.id !== STANDARD_ID && typeof preset.name === 'string' && pictureFits && typeof preset.extra === 'string';
}

/** The looks the user made, in the order they were made. */
export function loadPresets(host: Pick<AppHost, 'loadData'>): SignaturePreset[] {
  const stored = host.loadData<unknown>(PRESETS_KEY);
  if (!Array.isArray(stored)) return [];
  return stored
    .filter(isPreset)
    .slice(0, MOST_PRESETS)
    .map((preset) => ({ ...STANDARD_PRESET, ...preset, showName: preset.showName !== false, showDate: preset.showDate !== false, showReason: preset.showReason === true, showLocation: preset.showLocation === true, labels: preset.labels !== false }));
}

export function savePresets(host: Pick<AppHost, 'saveData'>, presets: readonly SignaturePreset[]): void {
  host.saveData(PRESETS_KEY, presets.slice(0, MOST_PRESETS));
}

/** The look used the last time: the one a new signature starts with. */
export function lastPresetId(host: Pick<AppHost, 'loadData'>): string {
  const stored = host.loadData<unknown>(LAST_KEY);
  return typeof stored === 'string' ? stored : STANDARD_ID;
}

export function rememberPreset(host: Pick<AppHost, 'saveData'>, id: string): void {
  host.saveData(LAST_KEY, id);
}

/** The presets with one added, or put in place of the one with the same id. */
export function withPreset(presets: readonly SignaturePreset[], preset: SignaturePreset): SignaturePreset[] {
  return presets.some((known) => known.id === preset.id) ? presets.map((known) => (known.id === preset.id ? preset : known)) : [...presets, preset];
}

/** What a signature says of itself, for the lines of its look. */
export interface SignatureFacts {
  readonly signer: string;
  /** When, already written out in the language of the program. */
  readonly moment: string;
  readonly reason: string;
  readonly location: string;
}

/** The words the lines start with, already translated; `{value}` is where the fact goes. */
export interface SignatureWords {
  readonly signedBy: string;
  readonly date: string;
  readonly reason: string;
  readonly location: string;
}

/** The lines of text a look writes for a signature. A fact that is empty leaves its line out. */
export function presetLines(preset: SignaturePreset, facts: SignatureFacts, words: SignatureWords): string[] {
  const line = (shown: boolean, value: string, labelled: string) => (shown && value.trim() !== '' ? [preset.labels ? labelled.split('{value}').join(value.trim()) : value.trim()] : []);
  const extra = preset.extra.split('\n').map((text) => text.trim()).filter((text) => text !== '');
  return [...line(preset.showName, facts.signer, words.signedBy), ...extra, ...line(preset.showDate, facts.moment, words.date), ...line(preset.showReason, facts.reason, words.reason), ...line(preset.showLocation, facts.location, words.location)];
}
