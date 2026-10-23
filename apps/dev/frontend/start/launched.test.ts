import { describe, expect, it } from 'vitest';
import manifest from '../../app.json';
import ar from '../../locales/ar.json';
import en from '../../locales/en.json';
import ro from '../../locales/ro.json';
import { TOOLS } from '../tools/catalog';
import { LAUNCH_ACTIONS, launchedBy, openerOf } from './launched';

const files = (...paths: string[]) => JSON.stringify(paths);

describe('what a tab was opened with from outside', () => {
  it('is nothing for a tab opened from inside the program', () => {
    expect(launchedBy({})).toBeNull();
    expect(launchedBy({ tool: 'hash' })).toBeNull();
    expect(launchedBy({ launch: 'open', files: '[]' })).toBeNull();
    expect(launchedBy({ launch: 'open', files: 'not json' })).toBeNull();
  });

  it('opens a file in the tool of its kind', () => {
    expect(launchedBy({ launch: 'open', files: files('C:\\data\\orders.JSON') })).toEqual({ tool: 'json-formatter', files: ['C:\\data\\orders.JSON'] });
    expect(launchedBy({ launch: 'open', files: files('/srv/site.pem') })?.tool).toBe('certificate');
    expect(launchedBy({ launch: 'open', files: files('/srv/site.pfx') })?.tool).toBe('keys');
    expect(launchedBy({ path: '/home/me/.ssh/id_ed25519.pub' })?.tool).toBe('keys');
    expect(launchedBy({ launch: 'open', files: files('a.sql', 'b.sql') })).toEqual({ tool: 'sql', files: ['a.sql', 'b.sql'] });
  });

  it('turns a converter toward reading the file', () => {
    expect(launchedBy({ launch: 'open', files: files('rows.csv') })?.turned).toEqual({ key: 'csv-json.options', values: { direction: 'decode' } });
    expect(launchedBy({ launch: 'open', files: files('compose.yml') })?.turned).toEqual({ key: 'yaml-json.options', values: { direction: 'decode' } });
    expect(launchedBy({ launch: 'open', files: files('dump.sql.gz') })).toMatchObject({ tool: 'gzip', turned: { values: { direction: 'decode' } } });
    expect(launchedBy({ launch: 'open', files: files('page.htm') })?.turned?.values).toEqual({ kind: 'html' });
  });

  it('shows the bytes of a file of a kind no tool reads', () => {
    expect(openerOf('C:\\video\\film.mkv')).toEqual({ tool: 'hex' });
    expect(openerOf('C:\\folder.with.dots\\README')).toEqual({ tool: 'hex' });
    expect(launchedBy({ launch: 'hex', files: files('a.json') })).toEqual({ tool: 'hex', files: ['a.json'] });
  });

  it('goes by the entry that was chosen, whatever the files are', () => {
    expect(launchedBy({ launch: 'checksum', files: files('a.json', 'b.iso') })).toEqual({ tool: 'hash', files: ['a.json', 'b.iso'], listed: true });
    expect(launchedBy({ launch: 'compare-folders', files: files('/old', '/new') })).toEqual({ tool: 'diff', files: ['/old', '/new'], folders: true });
    expect(launchedBy({ launch: 'compare', files: files('old.json', 'new.json') })).toEqual({ tool: 'diff', files: ['old.json', 'new.json'] });
  });

  it('opens a file the program was started with', () => {
    expect(launchedBy({ path: 'C:\\x\\settings.yaml' })).toMatchObject({ tool: 'yaml-json', files: ['C:\\x\\settings.yaml'] });
  });
});

describe('the entries Dev declares for the right-click menu', () => {
  const strings: Readonly<Record<string, Readonly<Record<string, string>>>> = { en, ro, ar };

  it('are the ones the tab knows what to do with', () => {
    expect(manifest.contextMenu.map((entry) => entry.id)).toEqual([...LAUNCH_ACTIONS]);
  });

  it('have their labels in every language', () => {
    for (const language of ['en', 'ro', 'ar']) for (const entry of manifest.contextMenu) expect(strings[language]?.[entry.labelKey], `${language} ${entry.labelKey}`).toBeTruthy();
  });

  it('open only kinds of files a tool that is built reads', () => {
    const open = manifest.contextMenu.find((entry) => entry.id === 'open');
    for (const type of [...(open?.fileTypes ?? []), ...manifest.fileTypes]) {
      expect(type.startsWith('.'), type).toBe(true);
      const { tool } = openerOf(`file${type}`);
      expect(tool, type).not.toBe('hex');
      expect(TOOLS.find((known) => known.id === tool && !known.later), type).toBeDefined();
    }
  });
});

describe('what the search of the Start page finds in Dev', () => {
  it('is every tool that is built, each opened as Dev opens it', () => {
    const built = TOOLS.filter((tool) => !tool.later).map((tool) => tool.id);
    expect(manifest.search.map((entry) => entry.id)).toEqual(built);
    for (const entry of manifest.search) {
      expect(entry.labelKey).toBe(`dev.tool.${entry.id}`);
      expect(entry.params).toEqual({ tool: entry.id });
      expect(en[entry.labelKey as keyof typeof en], entry.labelKey).toBeTruthy();
    }
  });
});
