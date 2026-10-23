import { describe, expect, it } from 'vitest';
import { bytesOf, letterOf, offsetOf, offsetText, readings, soughtBytes } from './hex-bytes';

describe('what is typed to be sought', () => {
  it('reads bytes in the ways they are written', () => {
    expect(soughtBytes('DE AD be ef', 'hex')).toBe('deadbeef');
    expect(soughtBytes('0xDE, 0xAD', 'hex')).toBe('dead');
    expect(soughtBytes('\\xCA\\xFE', 'hex')).toBe('cafe');
    expect(soughtBytes('de:ad-be_ef', 'hex')).toBe('deadbeef');
  });

  it('refuses what is no bytes', () => {
    expect(soughtBytes('', 'hex')).toBeNull();
    expect(soughtBytes('abc', 'hex')).toBeNull();
    expect(soughtBytes('zz', 'hex')).toBeNull();
    expect(soughtBytes('', 'text')).toBeNull();
  });

  it('takes a text as its bytes in UTF-8', () => {
    expect(soughtBytes('PK', 'text')).toBe('504b');
    expect(soughtBytes('ș', 'text')).toBe('c899');
    expect(soughtBytes('de ad', 'text')).toBe('6465206164');
  });

  it('takes a text as its units in UTF-16, either way round', () => {
    expect(soughtBytes('Aș', 'utf16le')).toBe('41001902');
    expect(soughtBytes('Aș', 'utf16be')).toBe('00410219');
    expect(soughtBytes('😀', 'utf16le')).toBe('3dd800de');
    expect(soughtBytes('', 'utf16le')).toBeNull();
  });
});

describe('a place typed to go to', () => {
  it('is decimal, or hexadecimal when written so', () => {
    expect(offsetOf('1024')).toBe(1024);
    expect(offsetOf(' 1 048 576 ')).toBe(1048576);
    expect(offsetOf('0x400')).toBe(1024);
    expect(offsetOf('400h')).toBe(1024);
    expect(offsetOf('0XFF')).toBe(255);
  });

  it('is nothing when it is neither', () => {
    expect(offsetOf('')).toBeNull();
    expect(offsetOf('ff')).toBeNull();
    expect(offsetOf('-1')).toBeNull();
    expect(offsetOf('0xFFFFFFFFFFFFFFFFFF')).toBeNull();
  });
});

describe('how a place is written', () => {
  it('is as wide as the last place needs', () => {
    expect(offsetText(255, 'hex', 1000)).toBe('000000FF');
    expect(offsetText(16, 'hex', 0x2_0000_0000)).toBe('000000010');
    expect(offsetText(7, 'decimal', 1000)).toBe('007');
    expect(offsetText(0, 'decimal', 0)).toBe('0');
  });
});

describe('the bytes at a place read as numbers', () => {
  const value = (bytes: string, name: string, littleEndian = true) => readings(bytesOf(bytes), littleEndian).find((reading) => reading.name === name)?.value;

  it('reads whole numbers both ways round', () => {
    expect(value('ff', 'int8')).toBe('-1');
    expect(value('ff', 'uint8')).toBe('255');
    expect(value('0100', 'uint16')).toBe('1');
    expect(value('0100', 'uint16', false)).toBe('256');
    expect(value('feffffff', 'int32')).toBe('-2');
    expect(value('ffffffffffffffff', 'uint64')).toBe('18446744073709551615');
    expect(value('ffffffffffffffff', 'int64')).toBe('-1');
  });

  it('reads floating-point numbers', () => {
    expect(value('0000803f', 'float32')).toBe('1');
    expect(value('000000000000f03f', 'float64')).toBe('1');
    expect(value('0000807f', 'float32')).toBe('+∞');
    expect(value('0000c07f', 'float32')).toBe('NaN');
  });

  it('tells what there are too few bytes for', () => {
    expect(value('ff', 'int16')).toBeNull();
    expect(value('ffffff', 'float32')).toBeNull();
    expect(value('', 'character')).toBeNull();
  });

  it('reads the first byte in binary, the character and the moment', () => {
    expect(value('a5', 'binary')).toBe('10100101');
    expect(value('41', 'character')).toBe('A U+0041');
    expect(value('c899', 'character')).toBe('ș U+0219');
    expect(value('f09f9880', 'character')).toBe('😀 U+1F600');
    expect(value('0a', 'character')).toBe('U+000A');
    expect(value('ff41', 'character')).toBeNull();
    expect(value('00000000', 'time')).toBe('1970-01-01T00:00:00Z');
    expect(value('80510100', 'time')).toBe('1970-01-02T00:00:00Z');
  });
});

describe('a byte in the column of text', () => {
  it('is itself when it can be seen', () => {
    expect(letterOf(0x41)).toBe('A');
    expect(letterOf(0x20)).toBe(' ');
    expect(letterOf(0x00)).toBe('·');
    expect(letterOf(0x7f)).toBe('·');
    expect(letterOf(0xe2)).toBe('·');
  });

  it('is a Western European letter when those are asked for', () => {
    expect(letterOf(0xe2, 'latin1')).toBe('â');
    expect(letterOf(0x80, 'latin1')).toBe('€');
    expect(letterOf(0x41, 'latin1')).toBe('A');
    expect(letterOf(0x00, 'latin1')).toBe('·');
    expect(letterOf(0xa0, 'latin1')).toBe('·');
    expect(letterOf(0x81, 'latin1')).toBe('·');
  });
});
