import { describe, expect, it } from 'vitest';
import en from '../../locales/en.json';
import { initialValues, isReady, operationOf, TOOL_GROUPS, toolById, TOOLS, visibleFields, withValue } from './tool-definitions';

const texts: Record<string, string> = en;

describe('tools', () => {
  it('have each a name, a hint and a group that are written', () => {
    for (const tool of TOOLS) {
      expect(texts[`scribe.tool.${tool.id}`], `name of ${tool.id}`).toBeTruthy();
      expect(texts[`scribe.toolHint.${tool.id}`], `hint of ${tool.id}`).toBeTruthy();
      expect(TOOL_GROUPS).toContain(tool.group);
    }
    for (const group of TOOL_GROUPS) expect(texts[`scribe.toolGroup.${group}`]).toBeTruthy();
  });

  it('have every choice and every option named', () => {
    for (const tool of TOOLS) {
      for (const field of tool.fields) {
        expect(texts[`scribe.field.${tool.id}.${field.name}`] ?? texts[`scribe.field.${field.name}`], `${tool.id}.${field.name}`).toBeTruthy();
        if (field.kind === 'choice') for (const option of field.options) expect(texts[`scribe.option.${tool.id}.${field.name}.${option}`] ?? texts[`scribe.option.${field.name}.${option}`], `${tool.id}.${field.name}.${option}`).toBeTruthy();
      }
    }
  });

  it('make the operation the Rust side is asked for', () => {
    const sort = toolById('sortLines');
    expect(sort && operationOf(sort, { ...initialValues(sort), descending: true }, 'ro')).toEqual(expect.objectContaining({ kind: 'sortLines', by: 'alphabetical', descending: true, caseSensitive: false, language: 'ro', key: 'line', keepHeader: false }));
    const replace = toolById('replace');
    expect(replace && operationOf(replace, { find: 'a', with: 'b' }, 'ro')).toEqual({ kind: 'replace', find: 'a', with: 'b', regex: false, caseSensitive: false, wholeWord: false, keepCase: false, fill: false });
  });

  it('make the generator a tool that writes asks for', () => {
    const filler = toolById('fillerText');
    expect(filler?.makes).toBe(true);
    expect(filler && operationOf(filler, { ...initialValues(filler), count: 2 }, 'ro')).toEqual(expect.objectContaining({ kind: 'fillerText', words: 'latin', unit: 'paragraphs', count: 2, classicStart: true, format: 'plain', seed: 0 }));
    // Filler of the user's own words waits for the words; any other does not.
    expect(filler && isReady(filler, initialValues(filler))).toBe(true);
    expect(filler && isReady(filler, { ...initialValues(filler), words: 'custom' })).toBe(false);
    expect(filler && isReady(filler, { ...initialValues(filler), words: 'custom', ownWords: 'unu doi' })).toBe(true);
    const sample = toolById('sampleData');
    expect(sample && isReady(sample, { ...initialValues(sample), what: 'pattern', pattern: ' ' })).toBe(false);
    expect(sample && isReady(sample, initialValues(sample))).toBe(true);
    const random = toolById('randomText');
    expect(random && withValue(random, initialValues(random), 'length', 99_999).length).toBe(4096);
  });

  it('sort in the language asked for by name, else in the language of the program', () => {
    const sort = toolById('sortLines');
    expect(sort && operationOf(sort, { ...initialValues(sort), language: 'sv' }, 'ro').language).toBe('sv');
    expect(sort && operationOf(sort, { ...initialValues(sort), language: 'auto' }, 'ro').language).toBe('ro');
    expect(sort && initialValues(sort).language).toBe('auto');
    expect(texts['scribe.field.language'] && texts['scribe.option.language.auto']).toBeTruthy();
  });

  it('show a choice that depends on another only while the other says so', () => {
    const sort = toolById('sortLines');
    const names = (values: Record<string, string | number | boolean>) => (sort ? visibleFields(sort, { ...initialValues(sort), ...values }).map((field) => field.name) : []);
    expect(names({})).not.toContain('position');
    expect(names({})).not.toContain('order');
    expect(names({ key: 'column' })).toEqual(expect.arrayContaining(['position', 'delimiter']));
    expect(names({ key: 'word' })).not.toContain('delimiter');
    expect(names({ by: 'custom' })).toContain('order');
    expect(names({ by: 'date' })).toContain('dateOrder');
    expect(names({ by: 'random' })).not.toContain('descending');
    // Every choice another depends on is a choice of the same tool.
    for (const tool of TOOLS) for (const field of tool.fields) if (field.when) expect(tool.fields.some((known) => known.name === field.when?.field), `${tool.id}.${field.name}`).toBe(true);
  });

  it('wait for what they cannot do without', () => {
    const replace = toolById('replace');
    expect(replace && isReady(replace, initialValues(replace))).toBe(false);
    expect(replace && isReady(replace, { ...initialValues(replace), find: 'x' })).toBe(true);
    const reverse = toolById('reverseLines');
    expect(reverse && isReady(reverse, {})).toBe(true);
  });

  it('keep a number inside what its field allows', () => {
    const tabs = toolById('tabsToSpaces');
    expect(tabs && withValue(tabs, initialValues(tabs), 'width', 99).width).toBe(16);
    expect(tabs && withValue(tabs, initialValues(tabs), 'width', Number.NaN).width).toBe(4);
    expect(tabs && withValue(tabs, initialValues(tabs), 'nothing', 1)).toEqual({ width: 4 });
  });
});
