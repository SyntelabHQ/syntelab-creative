import { describe, expect, it } from 'vitest';
import { planFromDocument, swapPages } from '../document/page-plan';
import { answer, answersForPage, OFF, valueOf } from './form-fields';
import type { FormField } from './form-fields';

const field = (id: number, kind: FormField['kind'], name: string, more: Partial<FormField> = {}): FormField => ({
  page: 0,
  id,
  name,
  label: '',
  kind,
  value: kind === 'text' || kind === 'choice' ? '' : OFF,
  area: [0, 0, 10, 10],
  readOnly: false,
  multiline: false,
  options: [],
  on: kind === 'checkbox' || kind === 'radio' ? 'Yes' : null,
  maxLength: null,
  ...more,
});

describe('form answers', () => {
  const name = field(1, 'text', 'name', { value: 'Ana' });
  const cash = field(2, 'radio', 'payment', { on: 'cash' });
  const card = field(3, 'radio', 'payment', { on: 'card', value: 'card' });
  const agree = field(4, 'checkbox', 'agree', { page: 1 });
  const fields = [name, cash, card, agree];

  it('shows the answer over what the file has', () => {
    expect(valueOf(name, new Map())).toBe('Ana');
    expect(valueOf(name, new Map([[1, 'Maria']]))).toBe('Maria');
  });

  it('forgets an answer that is what the file already has', () => {
    const changed = answer(fields, new Map(), name, 'Maria');
    expect([...changed]).toEqual([[1, 'Maria']]);
    expect(answer(fields, changed, name, 'Ana').size).toBe(0);
  });

  it('clears the other buttons of a radio group', () => {
    const chosen = answer(fields, new Map(), cash, 'cash');
    expect(valueOf(cash, chosen)).toBe('cash');
    expect(valueOf(card, chosen)).toBe(OFF);
    // Back to what the file has: nothing left to save.
    expect(answer(fields, chosen, card, 'card').size).toBe(0);
  });

  it('sends answers only with pages that are still as in the file', () => {
    const answers = new Map([[1, 'Maria'], [4, 'Yes']]);
    const [first, second] = planFromDocument(7, [100, 100, 100, 100]);
    expect(answersForPage(first!, 7, fields, answers)).toEqual([{ id: 1, value: 'Maria' }]);
    expect(answersForPage(second!, 7, fields, answers)).toEqual([{ id: 4, value: 'Yes' }]);
    // Another document's page, and a page that came back changed.
    expect(answersForPage(first!, 8, fields, answers)).toEqual([]);
    const [changed] = swapPages([first!], [0], planFromDocument(9, [100, 100]));
    expect(answersForPage(changed!, 7, fields, answers)).toEqual([]);
  });
});
