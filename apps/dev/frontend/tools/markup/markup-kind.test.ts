import { describe, expect, it } from 'vitest';
import { markupKindOf } from './markup-kind';

describe('markupKindOf', () => {
  it('tells HTML from XML as the Rust side does', () => {
    expect(markupKindOf('<!DOCTYPE html><html></html>')).toBe('html');
    expect(markupKindOf('  <!-- note -->\n<div>a</div>')).toBe('html');
    expect(markupKindOf('hello <b>x</b>')).toBe('html');
    expect(markupKindOf('<?xml version="1.0"?><a/>')).toBe('xml');
    expect(markupKindOf('<root><div/></root>')).toBe('xml');
    expect(markupKindOf('<svg xmlns="http://www.w3.org/2000/svg"/>')).toBe('xml');
    expect(markupKindOf('')).toBe('xml');
  });
});
