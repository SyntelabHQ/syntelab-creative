import { describe, expect, it } from 'vitest';
import { loadI18n } from './i18n';
import { fallbackChain, matchLanguage } from './languages';
import type { LanguageRegistry } from './languages';
import type { Messages } from './catalog';

const registry: LanguageRegistry = {
  source: 'en',
  rtl: ['ar'],
  languages: ['ar', 'en', 'pt', 'pt-BR', 'ro'].map((code) => ({ code, native: code, english: code })),
};
const codes = registry.languages.map((language) => language.code);

const files: Record<string, Messages> = {
  en: {
    'common.action.open': 'Open',
    'common.action.save': 'Save',
    'common.page.count': '{count, plural, one {# page} other {# pages}}',
  },
  ro: {
    'common.action.open': 'Deschide',
    'common.page.count': '{count, plural, one {# pagină} few {# pagini} other {# de pagini}}',
  },
  pt: { 'common.action.open': 'Abrir' },
  'pt-BR': {},
  ar: { 'common.action.open': 'فتح' },
};

const loader = async (language: string) => files[language] ?? {};

describe('fallbackChain', () => {
  it('goes from language to base language to source', () => {
    expect(fallbackChain('pt-BR', 'en')).toEqual(['pt-BR', 'pt', 'en']);
    expect(fallbackChain('ro', 'en')).toEqual(['ro', 'en']);
    expect(fallbackChain('en', 'en')).toEqual(['en']);
  });
});

describe('matchLanguage', () => {
  it('prefers an exact match, then the base language, then the source', () => {
    expect(matchLanguage(['pt-br'], codes, 'en')).toBe('pt-BR');
    expect(matchLanguage(['ro-RO', 'en-US'], codes, 'en')).toBe('ro');
    expect(matchLanguage(['xx'], codes, 'en')).toBe('en');
  });
});

describe('loadI18n', () => {
  it('translates and falls back to the base and source languages', async () => {
    const i18n = await loadI18n({ language: 'pt-BR', registry, loader });
    expect(i18n.t('common.action.open')).toBe('Abrir');
    expect(i18n.t('common.action.save')).toBe('Save');
    expect(i18n.tSource('common.action.open')).toBe('Open');
  });

  it('applies the plural rules of the language the text is written in', async () => {
    const i18n = await loadI18n({ language: 'ro', registry, loader });
    expect(i18n.t('common.page.count', { count: 1 })).toBe('1 pagină');
    expect(i18n.t('common.page.count', { count: 3 })).toBe('3 pagini');
    expect(i18n.t('common.page.count', { count: 25 })).toBe('25 de pagini');
  });

  it('reports the text direction', async () => {
    expect((await loadI18n({ language: 'ar', registry, loader })).direction).toBe('rtl');
    expect((await loadI18n({ language: 'ro', registry, loader })).direction).toBe('ltr');
  });

  it('returns the key and reports it when no language has it', async () => {
    const missing: string[] = [];
    const i18n = await loadI18n({ language: 'ro', registry, loader, onMissing: (key) => missing.push(key) });
    expect(i18n.t('common.nope')).toBe('common.nope');
    expect(missing).toEqual(['common.nope']);
  });
});
