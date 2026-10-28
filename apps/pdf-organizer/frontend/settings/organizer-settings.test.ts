import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, isDefault, isTimeStampServer, readSettings, settingsToStore } from './organizer-settings';

describe('organizer settings', () => {
  it('start as the defaults', () => {
    expect(readSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.openZoom).toBe('fit-page');
    expect(DEFAULT_SETTINGS.openScrolling).toBe(false);
    expect(DEFAULT_SETTINGS.openThumbnails).toBe(true);
  });

  it('store only what was changed, and read it back', () => {
    const changed = { ...DEFAULT_SETTINGS, openScrolling: true, newName: 'scan_{number}' };
    const stored = settingsToStore(changed);
    expect(stored).toEqual({ openScrolling: true, newName: 'scan_{number}' });
    expect(readSettings(stored)).toEqual(changed);
    expect(isDefault(changed, 'newName')).toBe(false);
    expect(isDefault(changed, 'unit')).toBe(true);
  });

  it('drop what is no longer valid', () => {
    // A setting the program no longer has is dropped.
    const read = readSettings({ openZoom: 'huge', openThumbnails: 'yes', quickTools: ['share', 'pages'] });
    expect(read.openZoom).toBe('fit-page');
    expect(read.openThumbnails).toBe(true);
    expect(read).not.toHaveProperty('quickTools');
    expect(readSettings({ unit: 'furlong', printSheet: 'napkin', gridSpacing: -4 })).toEqual(DEFAULT_SETTINGS);
    expect(readSettings({ unit: 'in', printSheet: 'letter', gridSpacing: 36 })).toMatchObject({ unit: 'in', printSheet: 'letter', gridSpacing: 36 });
  });

  it('print on A4 unless told otherwise, turning the sheet for wide pages', () => {
    expect(DEFAULT_SETTINGS.printSheet).toBe('a4');
    expect(DEFAULT_SETTINGS.printOrientation).toBe('auto');
    expect(DEFAULT_SETTINGS.unit).toBe('mm');
  });

  it('ask DigiCert for time stamps unless another authority is set, and only at an address one can be at', () => {
    expect(DEFAULT_SETTINGS.timeStampSignatures).toBe(true);
    expect(DEFAULT_SETTINGS.timeStampServer).toBe('http://timestamp.digicert.com');
    expect(readSettings({ timeStampServer: ' https://freetsa.org/tsr ' }).timeStampServer).toBe('https://freetsa.org/tsr');
    for (const wrong of ['', 'timestamp.digicert.com', 'file:///c:/x', 'http://user:secret@tsa.example.com', 42]) {
      expect(readSettings({ timeStampServer: wrong }).timeStampServer).toBe(DEFAULT_SETTINGS.timeStampServer);
    }
    expect(isTimeStampServer('http://tsa.example.com:8080/stamp')).toBe(true);
    expect(isTimeStampServer('ftp://tsa.example.com')).toBe(false);
  });
});
