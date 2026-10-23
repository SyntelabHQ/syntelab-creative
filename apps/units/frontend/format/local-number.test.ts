import { describe, expect, it } from 'vitest';
import { copiedNumber, localNumber, marksOf, thousandsMark } from './local-number';

describe('numbers as a language writes them', () => {
  it('knows the marks of a language', () => {
    expect(marksOf('en').decimal).toBe('.');
    expect(marksOf('ro').decimal).toBe(',');
    expect(marksOf('de').decimal).toBe(',');
  });

  it('writes the decimals and the thousands of the language', () => {
    expect(localNumber('1234567.50', 'en')).toBe('1,234,567.50');
    expect(localNumber('1234567.50', 'ro')).toBe('1.234.567,50');
    expect(localNumber('1234.5', 'en')).toBe('1234.5');
    expect(localNumber('12345', 'en')).toBe('12,345');
    expect(localNumber('0.00001', 'ro')).toBe('0,00001');
    expect(localNumber('-40.0', 'en')).toBe('−40.0');
  });

  it('writes a power of ten as one', () => {
    expect(localNumber('1.61626e-35', 'en')).toBe('1.61626 × 10⁻³⁵');
    expect(localNumber('9.46073e15', 'ro')).toBe('9,46073 × 10¹⁵');
  });

  it('copies a number a spreadsheet can read', () => {
    expect(copiedNumber('1234567.50', 'ro')).toBe('1234567,50');
    expect(copiedNumber('1.61626e-35', 'en')).toBe('1.61626e-35');
  });
});

describe('the mark between thousands the user chose', () => {
  it('writes a space, a comma or nothing', () => {
    expect(localNumber('10000.000', 'en', 'space')).toBe('10\u00A0000.000');
    expect(localNumber('10000.000', 'en', 'comma')).toBe('10,000.000');
    expect(localNumber('10000.000', 'en', 'none')).toBe('10000.000');
    expect(localNumber('-1234567.5', 'en', 'space')).toBe('−1\u00A0234\u00A0567.5');
  });

  it('never writes the decimal mark between thousands', () => {
    expect(thousandsMark('comma', ',')).toBe('.');
    expect(localNumber('10000.5', 'ro', 'comma')).toBe('10.000,5');
    expect(localNumber('10000.5', 'ro', 'space')).toBe('10\u00A0000,5');
  });
});
