import { describe, expect, it } from 'vitest';
import { signaturesVerdict } from './use-file-counts';
import type { CheckedSignature } from './use-file-counts';

const good: CheckedSignature = { intact: true, wholeFile: true, signedAfter: false, trust: 'trusted' };

describe('signaturesVerdict', () => {
  it('says nothing of a file without signatures', () => {
    expect(signaturesVerdict([])).toBeNull();
  });

  it('is valid when every signature is intact, whole and trusted', () => {
    expect(signaturesVerdict([{ ...good, wholeFile: false, signedAfter: true }, good])).toBe('valid');
  });

  it('gives the worst of what the signatures say', () => {
    expect(signaturesVerdict([good, { ...good, trust: 'untrusted' }])).toBe('unconfirmed');
    expect(signaturesVerdict([{ ...good, trust: 'expired' }, { ...good, wholeFile: false }])).toBe('added');
    expect(signaturesVerdict([{ ...good, wholeFile: false }, { ...good, intact: false }])).toBe('invalid');
  });
});
