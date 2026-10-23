import { describe, expect, it } from 'vitest';
import { isTaken, takePicture } from './page-pictures';

const picture = { number: 1, x: 20, y: 30, width: 100, height: 60 };

describe('pictures of the document', () => {
  it('takes a picture out and puts the same one in its place', () => {
    const { erase, taken } = takePicture(picture, 'data:image/png;base64,AA', 'p');
    expect(erase).toMatchObject({ kind: 'erasePicture', x: 20, y: 30, width: 100, height: 60 });
    expect(taken).toMatchObject({ kind: 'picture', x: 20, y: 30, width: 100, height: 60, data: 'data:image/png;base64,AA' });
    expect(erase.id).not.toBe(taken.id);
  });

  it('does not offer a picture that was taken out already', () => {
    const { erase, taken } = takePicture(picture, 'data:image/png;base64,AA', 'p');
    expect(isTaken(picture, [erase])).toBe(true);
    // The picture put in its place may be anywhere by now: it is the other mark that counts.
    expect(isTaken(picture, [{ ...taken, x: 300 }])).toBe(false);
    expect(isTaken({ ...picture, x: 400 }, [erase])).toBe(false);
  });
});
