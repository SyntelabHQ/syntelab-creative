import { describe, expect, it } from 'vitest';
import { compareVersions } from './compare-versions';
import { DOWNLOAD_PAGE, parseUpdateInfo } from './update-info';

describe('compareVersions', () => {
  it('compares number by number, not as text', () => {
    expect(compareVersions('0.9.0', '0.10.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '0.99.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
  });

  it('ignores pre-release and build suffixes', () => {
    expect(compareVersions('1.2.3-beta.1', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.3+build5', '1.2.4')).toBeLessThan(0);
  });
});

describe('parseUpdateInfo', () => {
  it('reads the newest version and where to get it', () => {
    const info = parseUpdateInfo({
      version: 1,
      latest: '0.2.0',
      date: '2026-11-01',
      download: 'https://syntelab.com/creative/download',
      notes: { en: 'New things.' },
    });
    expect(info).toEqual({
      latest: '0.2.0',
      date: '2026-11-01',
      download: 'https://syntelab.com/creative/download',
      notes: { en: 'New things.' },
    });
  });

  it('reads the file the updater of Tauri reads too', () => {
    const info = parseUpdateInfo({
      version: '0.2.0',
      pub_date: '2026-11-01T00:00:00Z',
      notes: 'New things.',
      notes_by_language: { en: 'New things.', ro: 'Lucruri noi.' },
      download: 'https://syntelab.com/creative/download',
      platforms: { 'windows-x86_64': { url: 'https://github.com/SyntelabHQ/syntelab-creative/releases/download/v0.2.0/syntelab-creative-setup.exe', signature: '' } },
    });
    expect(info).toEqual({
      latest: '0.2.0',
      date: '2026-11-01',
      download: 'https://syntelab.com/creative/download',
      notes: { en: 'New things.', ro: 'Lucruri noi.' },
    });
    expect(parseUpdateInfo({ version: '0.2.0', notes: 'Only English.' })?.notes).toEqual({ en: 'Only English.' });
  });

  it('never keeps a download address outside the sites of Syntelab', () => {
    expect(parseUpdateInfo({ latest: '0.2.0', download: 'https://example.com/x.exe' })?.download).toBe(DOWNLOAD_PAGE);
    expect(parseUpdateInfo({ latest: '0.2.0', download: 'https://syntelab.com.example.com/' })?.download).toBe(DOWNLOAD_PAGE);
    expect(parseUpdateInfo({ latest: '0.2.0' })?.download).toBe(DOWNLOAD_PAGE);
  });

  it('refuses a file without a version', () => {
    expect(parseUpdateInfo(null)).toBeNull();
    expect(parseUpdateInfo({ latest: 'soon' })).toBeNull();
    expect(parseUpdateInfo({ items: [] })).toBeNull();
  });
});
