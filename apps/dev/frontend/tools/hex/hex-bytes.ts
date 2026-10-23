/**
 * What the hex viewer works out by itself: what is typed to be sought or
 * gone to, read as bytes and as a place; and what the bytes at a place say
 * when they are read as numbers.
 */

/** The bytes written as hexadecimal digits, two for each, as the Rust side gives them. */
export function bytesOf(written: string): Uint8Array {
  const bytes = new Uint8Array(written.length >> 1);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(written.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

const twoDigits = (byte: number) => byte.toString(16).padStart(2, '0');

/**
 * What is typed to be sought, as hexadecimal digits (two for each byte), the
 * way the Rust side takes it; null when it is not something to seek. As
 * `hex`: digits in any of the ways bytes are written (`DE AD`, `dead`,
 * `0xDE, 0xAD`, `\xDE\xAD`). As `text`: its bytes in UTF-8. As `utf16le`
 * or `utf16be`: its bytes in UTF-16, the low byte of each unit first or last
 * (how Windows keeps text, and how files of other systems may).
 */
export function soughtBytes(typed: string, as: 'hex' | 'text' | 'utf16le' | 'utf16be'): string | null {
  if (as === 'text') return typed === '' ? null : [...new TextEncoder().encode(typed)].map(twoDigits).join('');
  if (as === 'utf16le' || as === 'utf16be') {
    let digits = '';
    for (let index = 0; index < typed.length; index += 1) {
      const unit = typed.charCodeAt(index);
      digits += as === 'utf16le' ? twoDigits(unit & 255) + twoDigits(unit >> 8) : twoDigits(unit >> 8) + twoDigits(unit & 255);
    }
    return digits === '' ? null : digits;
  }
  const digits = typed.replace(/0x|\\x/gi, '').replace(/[\s,;:_-]/g, '');
  return digits !== '' && digits.length % 2 === 0 && /^[0-9a-f]+$/i.test(digits) ? digits.toLowerCase() : null;
}

/**
 * A place typed to go to: a count of bytes from the start, in decimal
 * (`1024`, `1 024`) or in hexadecimal (`0x400`, `400h`). Null when it is
 * neither, or too large to be a place.
 */
export function offsetOf(typed: string): number | null {
  const text = typed.trim().replace(/[\s_,.']/g, '');
  const hex = /^0x([0-9a-f]+)$/i.exec(text) ?? /^([0-9a-f]+)h$/i.exec(text);
  const value = hex ? Number.parseInt(hex[1] ?? '', 16) : /^\d+$/.test(text) ? Number(text) : Number.NaN;
  return Number.isSafeInteger(value) ? value : null;
}

/** A place as it is written beside its row: hexadecimal digits (eight, or more for what lies beyond 4 GB), or a decimal count. */
export function offsetText(offset: number, base: 'hex' | 'decimal', size: number): string {
  if (base === 'decimal') return String(offset).padStart(String(Math.max(size - 1, 0)).length, '0');
  return offset.toString(16).toUpperCase().padStart(Math.max(8, Math.max(size - 1, 0).toString(16).length), '0');
}

/** The letters Windows-1252 has for the bytes 0x80 to 0x9F (a space where it has none); from 0xA0 on they are those of Unicode. */
const WESTERN = '€ ‚ƒ„…†‡ˆ‰Š‹Œ Ž  ‘’“”•–—˜™š›œ žŸ';

/**
 * A byte as a letter in the column of text: itself when it is a letter of
 * ASCII that can be seen, else a dot. With `latin1`, the bytes beyond ASCII
 * are the letters Windows-1252 has for them (the Western European letters).
 */
export function letterOf(byte: number, letters: 'ascii' | 'latin1' = 'ascii'): string {
  if (byte >= 0x20 && byte < 0x7f) return String.fromCharCode(byte);
  if (letters === 'latin1' && byte >= 0x80) {
    const letter = byte < 0xa0 ? (WESTERN[byte - 0x80] ?? ' ') : String.fromCharCode(byte);
    // The bytes that are no letter there, the space that does not break and the soft hyphen stay a dot.
    return letter === ' ' || byte === 0xa0 || byte === 0xad ? '·' : letter;
  }
  return '·';
}

/** One way of reading the bytes at a place. `value` is null when there are too few bytes left for it. */
export interface Reading {
  /** Its name, which is the same in every language: `int32`, `float64`, … except the last ones, named by a key. */
  readonly name: string;
  readonly value: string | null;
}

/** The names of the readings that are words, and so are translated (`dev.hex.reading.<name>`). */
export const WORDED_READINGS = ['binary', 'character', 'time'] as const;

/**
 * The bytes at a place, read in each of the ways numbers are kept: whole
 * numbers of 8 to 64 bits with and without a sign, the two floating-point
 * sizes, the first byte in binary, the character that begins there in
 * UTF-8, and the moment a count of seconds since 1970 stands for.
 * `bytes` are those from the place on (eight are enough).
 */
export function readings(bytes: Uint8Array, littleEndian: boolean): Reading[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const read = (size: number, value: () => string): string | null => (bytes.length >= size ? value() : null);
  const float = (value: number) => (Number.isFinite(value) ? String(value) : Number.isNaN(value) ? 'NaN' : value > 0 ? '+∞' : '−∞');
  let character: string | null = null;
  if (bytes.length > 0) {
    // The first whole character: tried at each length UTF-8 writes one in.
    for (let length = 1; length <= Math.min(4, bytes.length) && character === null; length += 1) {
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
        const code = text.codePointAt(0) ?? 0;
        character = `${code < 0x20 || code === 0x7f ? '' : `${text} `}U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
      } catch {
        // Not a whole character at this length.
      }
    }
  }
  const seconds = bytes.length >= 4 ? view.getUint32(0, littleEndian) : null;
  return [
    { name: 'int8', value: read(1, () => String(view.getInt8(0))) },
    { name: 'uint8', value: read(1, () => String(view.getUint8(0))) },
    { name: 'int16', value: read(2, () => String(view.getInt16(0, littleEndian))) },
    { name: 'uint16', value: read(2, () => String(view.getUint16(0, littleEndian))) },
    { name: 'int32', value: read(4, () => String(view.getInt32(0, littleEndian))) },
    { name: 'uint32', value: read(4, () => String(view.getUint32(0, littleEndian))) },
    { name: 'int64', value: read(8, () => String(view.getBigInt64(0, littleEndian))) },
    { name: 'uint64', value: read(8, () => String(view.getBigUint64(0, littleEndian))) },
    { name: 'float32', value: read(4, () => float(view.getFloat32(0, littleEndian))) },
    { name: 'float64', value: read(8, () => float(view.getFloat64(0, littleEndian))) },
    { name: 'binary', value: read(1, () => view.getUint8(0).toString(2).padStart(8, '0')) },
    { name: 'character', value: character },
    { name: 'time', value: seconds === null ? null : new Date(seconds * 1000).toISOString().replace('.000Z', 'Z') },
  ];
}
