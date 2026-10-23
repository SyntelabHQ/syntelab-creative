import { describe, expect, it } from 'vitest';
import { searchLanguages } from './language-search';
import type { LanguageOption } from './language-search';

const options: LanguageOption[] = [
  { code: 'en', native: 'English', translated: 'Engleză', english: 'English', available: true },
  { code: 'ro', native: 'Română', translated: 'Română', english: 'Romanian', available: true },
  { code: 'el', native: 'Ελληνικά', translated: 'Greacă', english: 'Greek', available: false },
  { code: 'pt-BR', native: 'Português (Brasil)', translated: 'Portugheză (Brazilia)', english: 'Brazilian Portuguese', available: false },
];
const codes = (query: string) => searchLanguages(options, query).map((option) => option.code);

describe('searchLanguages', () => {
  it('keeps the whole list, in order, for an empty query', () => {
    expect(codes('  ')).toEqual(['en', 'ro', 'el', 'pt-BR']);
  });

  it('finds a language by its own name, its translated name, its English name or its code', () => {
    expect(codes('Ελλη')).toEqual(['el']);
    expect(codes('greaca')).toEqual(['el']);
    expect(codes('greek')).toEqual(['el']);
    expect(codes('pt-br')).toEqual(['pt-BR']);
  });

  it('ignores diacritics and case, and needs every word', () => {
    expect(codes('ROMANA')).toEqual(['ro']);
    expect(codes('portugheza brazilia')).toEqual(['pt-BR']);
    expect(codes('portugheza franta')).toEqual([]);
  });
});
