import { describe, expect, it } from 'vitest';
import en from '../../locales/en.json';
import { SHORTCUTS } from '../commands';
import { newFileForm } from '../document/text-file';
import { DEFAULT_SETTINGS, EDITOR_FONTS, NEW_LINE_ENDINGS, readSettings, SETTING_KEYS } from './scribe-settings';

const texts: Record<string, string> = en;

describe('the settings of Scribe', () => {
  it('are as the program ships them when nothing is stored, or what is stored is not valid', () => {
    expect(readSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings({ fontSize: 'big', font: 'comic', newLineEnding: 'cr', newMark: 'yes', sidePanel: 'none' })).toEqual(DEFAULT_SETTINGS);
    expect(readSettings({ fontSize: 400 }).fontSize).toBe(32);
    expect(readSettings({ newLineEnding: 'lf', newMark: true, sidePanel: 'recipes' })).toMatchObject({ newLineEnding: 'lf', newMark: true, sidePanel: 'recipes' });
  });

  it('say what a new text is saved as', () => {
    expect(newFileForm({ newLineEnding: 'system', newMark: false }, 'Win32')).toEqual({ encoding: 'UTF-8', mark: false, lineEnding: 'crlf' });
    expect(newFileForm({ newLineEnding: 'system', newMark: false }, 'MacIntel')).toEqual({ encoding: 'UTF-8', mark: false, lineEnding: 'lf' });
    expect(newFileForm({ newLineEnding: 'lf', newMark: true }, 'Win32')).toEqual({ encoding: 'UTF-8', mark: true, lineEnding: 'lf' });
  });

  it('have every name the Settings page shows', () => {
    for (const key of SETTING_KEYS) expect(texts[`scribe.settings.${key}`], key).toBeTruthy();
    for (const font of EDITOR_FONTS) expect(texts[`scribe.settings.font.${font}`] && texts[`scribe.settings.font.about.${font}`], font).toBeTruthy();
    for (const ending of NEW_LINE_ENDINGS) expect(texts[`scribe.settings.newLineEnding.${ending}`] && texts[`scribe.settings.newLineEnding.about.${ending}`], ending).toBeTruthy();
    for (const command of Object.keys(SHORTCUTS)) expect(texts[`scribe.command.${command}`], command).toBeTruthy();
  });
});
