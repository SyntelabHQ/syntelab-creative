import { describe, expect, it } from 'vitest';
import { loadSignatures, MAX_SAVED_SIGNATURES, withSignature } from './saved-signatures';

const signature = (name: string) => ({ address: `data:image/png;base64,${name}`, width: 100, height: 40 });

describe('saved signatures', () => {
  it('reads only what is a signature', () => {
    const host = { loadData: <T,>() => [signature('a'), { address: 'https://example.com/x.png', width: 1, height: 1 }, 'x', null] as T };
    expect(loadSignatures(host)).toEqual([signature('a')]);
    expect(loadSignatures({ loadData: () => undefined })).toEqual([]);
  });

  it('keeps the newest first, each once, and forgets the oldest', () => {
    const saved = [signature('a'), signature('b')];
    expect(withSignature(saved, signature('b')).map((item) => item.address.slice(-1))).toEqual(['b', 'a']);
    let many = saved;
    for (let index = 0; index < 10; index++) many = withSignature(many, signature(String(index)));
    expect(many).toHaveLength(MAX_SAVED_SIGNATURES);
    expect(many[0]).toEqual(signature('9'));
  });
});
