import type { AppEntry } from '@syntelab/shell-api';
import { describe, expect, it } from 'vitest';
import { moveApp, orderApps } from './app-order';

const app = (id: string) => ({ manifest: { id } }) as AppEntry;
const ids = (apps: readonly AppEntry[]) => apps.map((entry) => entry.manifest.id);

describe('orderApps', () => {
  const apps = [app('pdf-organizer'), app('convert'), app('dev'), app('scribe')];

  it('keeps the usual order when the user chose none', () => {
    expect(ids(orderApps(apps, []))).toEqual(['pdf-organizer', 'convert', 'dev', 'scribe']);
  });

  it('follows the chosen order, with new apps after it', () => {
    expect(ids(orderApps(apps, ['dev', 'pdf-organizer']))).toEqual(['dev', 'pdf-organizer', 'convert', 'scribe']);
  });

  it('ignores apps that no longer exist', () => {
    expect(ids(orderApps(apps, ['gone', 'scribe']))).toEqual(['scribe', 'pdf-organizer', 'convert', 'dev']);
  });
});

describe('moveApp', () => {
  const order = ['a', 'b', 'c', 'd'];

  it('moves an app earlier and later', () => {
    expect(moveApp(order, 'c', 0)).toEqual(['c', 'a', 'b', 'd']);
    expect(moveApp(order, 'a', 3)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveApp(order, 'a', 4)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('changes nothing when dropped on its own place', () => {
    expect(moveApp(order, 'b', 1)).toEqual(order);
    expect(moveApp(order, 'b', 2)).toEqual(order);
    expect(moveApp(order, 'x', 0)).toEqual(order);
  });
});
