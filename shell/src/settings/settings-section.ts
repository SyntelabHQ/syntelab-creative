import { createStore } from '../state/create-store';

/** The part of Settings for the whole suite; the others are app ids. */
export const GENERAL_SECTION = 'general';

/** The part of Settings that is shown: `GENERAL_SECTION`, or the id of an app. */
export const settingsSection = createStore<string>(GENERAL_SECTION);

/** Makes Settings show the part of one app (or the general one) the next time it is looked at. */
export function showSettingsSection(section: string): void {
  settingsSection.set(section);
}
