import { describe, expect, it } from 'vitest';
import { claimsOf, reportOf } from './jwt-report';

const NOW = Date.UTC(2026, 9, 11);
const payload = JSON.stringify({ iss: 'joe', exp: 1300819380, 'http://example.com/is_root': true, nbf: 4102444800, auth_time: 1300819000, aud: ['a', 'b'] });

describe('claimsOf', () => {
  it('names the claims of the standard and says the moments as dates', () => {
    expect(claimsOf(payload, NOW)).toEqual([
      { name: 'iss', value: 'joe' },
      { name: 'aud', value: '["a","b"]' },
      { name: 'exp', value: '1300819380', date: '2011-03-22T18:43:00.000Z', past: true },
      { name: 'nbf', value: '4102444800', date: '2100-01-01T00:00:00.000Z', past: false },
      { name: 'auth_time', value: '1300819000', date: '2011-03-22T18:36:40.000Z', past: true },
    ]);
  });

  it('leaves alone what is no moment, and what is no payload', () => {
    expect(claimsOf('{"exp":"soon","iat":1e300}', NOW)).toEqual([
      { name: 'exp', value: 'soon' },
      { name: 'iat', value: '1e+300' },
    ]);
    expect(claimsOf('not json', NOW)).toEqual([]);
    expect(claimsOf('[1]', NOW)).toEqual([]);
  });
});

describe('reportOf', () => {
  it('writes the header, the payload and the claims in words', () => {
    const texts = { header: 'HEADER', payload: 'PAYLOAD', claims: 'CLAIMS', claim: (name: string) => name.toUpperCase(), when: (_name: string, past: boolean) => (past ? 'past' : 'to come') };
    expect(reportOf('{"alg":"none"}', '{"exp":1300819380,"iat":1300819000}', texts, NOW)).toBe(
      ['HEADER', '{"alg":"none"}', '', 'PAYLOAD', '{"exp":1300819380,"iat":1300819000}', '', 'CLAIMS', 'exp  EXP: 2011-03-22T18:43:00.000Z (past)', 'iat  IAT: 2011-03-22T18:36:40.000Z'].join('\n'),
    );
    expect(reportOf('{}', '{"x":1}', texts, NOW)).toBe('HEADER\n{}\n\nPAYLOAD\n{"x":1}');
  });
});
