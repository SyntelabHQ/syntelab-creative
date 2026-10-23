import { describe, expect, it } from 'vitest';
import { recognize } from './recognize';

const kinds = (text: string) => recognize(text).map((guess) => guess.kind);
const first = (text: string) => recognize(text)[0];

describe('recognize', () => {
  it('tells nothing of nothing, and offers something for any text', () => {
    expect(recognize('  \n ')).toEqual([]);
    expect(kinds('just some words')).toEqual(['text']);
    expect(recognize('just some words')[0]?.tools).toContain('hash');
  });

  it('tells tokens and certificates before anything else', () => {
    // The token of RFC 7519, section 3.1.
    const token = 'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(first(token)).toEqual({ kind: 'jwt', tools: ['jwt'] });
    expect(first(`Bearer ${token}`)?.kind).toBe('jwt');
    expect(first('-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----')?.kind).toBe('certificate');
    expect(kinds('a.b.c')).toEqual(['text']);
  });

  it('tells JSON, and offers CSV for an array', () => {
    expect(first('{"a": [1, 2]}')?.tools.slice(0, 2)).toEqual(['json-formatter', 'jsonpath']);
    expect(first('[{"a":1}]')?.tools).toContain('csv-json');
    expect(first('{"a":1}')?.tools).not.toContain('csv-json');
    expect(kinds('{not json}')).not.toContain('json');
  });

  it('tells identifiers, moments, schedules and addresses, a line each', () => {
    expect(first('2ed6657d-e927-568b-95e1-2665a8aea6a2\n{017f22e2-79b0-7cc3-98c4-dc0c0c07398f}')?.kind).toBe('uuid');
    expect(first('1700000000\n1700000000000')?.kind).toBe('timestamp');
    expect(first('2026-10-12T08:30:00Z')?.kind).toBe('timestamp');
    expect(first('*/15 9-17 * * MON-FRI\n@daily\n0 0 9 ? * MON#2 *')?.kind).toBe('cron');
    expect(first('https://example.com/a?b=c%20d')).toEqual({ kind: 'url', tools: ['url-parser', 'url-encode'] });
    expect(kinds('https://example.com/a?b=c%20d')).not.toContain('percent');
    expect(kinds('five words on one line')).not.toContain('cron');
  });

  it('tells markup, SQL, digests and packed bytes', () => {
    expect(first('<?xml version="1.0"?><a/>')?.kind).toBe('xml');
    expect(first('<!DOCTYPE html><html></html>')?.kind).toBe('html');
    expect(first('select * from t where a = 1')?.kind).toBe('sql');
    expect(first('H4sIAAAAAAAAA0tMSgYAwkEkNQMAAAA=')?.kind).toBe('gzip');
    expect(first('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')).toEqual({ kind: 'digest', tools: ['hash'] });
    expect(first('aGVsbG8gd29ybGQsIGhlbGxv')?.kind).toBe('base64');
    expect(kinds('12345678')).not.toContain('base64');
  });

  it('tells what is written in an encoding', () => {
    expect(kinds('caf%C3%A9 au lait')).toContain('percent');
    expect(kinds('Tom &amp; Jerry &#169;')).toContain('entities');
    expect(kinds('line one\\nline two \\u00e9')).toContain('escaped');
  });

  it('tells tables and settings when nothing more particular fits', () => {
    expect(first('name;age\nAna;30\nBo;25')?.kind).toBe('csv');
    expect(first('name: Dev\nlist:\n  - one')?.kind).toBe('yaml');
    expect(kinds('a, b\nc')).not.toContain('csv');
  });

  it('judges a long text by its start', () => {
    const long = `[${'{"a":1},'.repeat(400_000)}{"a":1}]`;
    expect(first(long)?.kind).toBe('json');
    expect(first(`${'1700000000\n'.repeat(20_000)}`)?.kind).toBe('timestamp');
  });
});
