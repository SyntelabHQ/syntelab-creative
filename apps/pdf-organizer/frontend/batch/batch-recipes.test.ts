import { describe, expect, it } from 'vitest';
import { DEFAULT_JOB } from './batch-actions';
import { loadRecipes, saveRecipes, withRecipe } from './batch-recipes';
import type { BatchRecipe } from './batch-recipes';
import { DEFAULT_SIGN_SETTINGS } from './sign-settings';

const recipe = (name: string, id = name): BatchRecipe => ({ id, name, job: { ...DEFAULT_JOB, steps: ['numbers', 'sign'] }, output: 'each', added: '_final', oneName: '', folder: 'C:\\out', sign: { ...DEFAULT_SIGN_SETTINGS, reason: 'Approved' }, certificateId: 'abc', presetId: 'p1' });

function storage() {
  const kept = new Map<string, unknown>();
  return { loadData: <T>(key: string) => kept.get(key) as T | undefined, saveData: (key: string, value: unknown) => void kept.set(key, JSON.parse(JSON.stringify(value))) };
}

describe('batch recipes', () => {
  it('finds again what was saved', () => {
    const host = storage();
    saveRecipes(host, [recipe('For the company')]);
    expect(loadRecipes(host)).toEqual([recipe('For the company')]);
  });

  it('makes whole what is stored in part, and leaves out what is not a recipe', () => {
    const host = storage();
    host.saveData('batchRecipes', [{ id: 'a', name: 'Old', job: { steps: ['sign', 'unknown', 'rotate'] }, output: 'elsewhere', sign: { place: 'nowhere' } }, { id: 'b' }, 'x']);
    const [old, ...rest] = loadRecipes(host);
    expect(rest).toHaveLength(0);
    expect(old?.job.steps).toEqual(['rotate', 'sign']);
    expect(old?.output).toBe('each');
    expect(old?.added).toBeNull();
    expect(old?.sign.spot).toEqual(DEFAULT_SIGN_SETTINGS.spot);
  });

  it('reads the signing of a recipe kept before pages and spots', () => {
    const host = storage();
    host.saveData('batchRecipes', [
      { id: 'a', name: 'Hidden', sign: { visible: false, onLastPage: true, place: 'top-left' } },
      { id: 'b', name: 'First', sign: { visible: true, onLastPage: false, place: 'top-left' } },
    ]);
    const [hidden, first] = loadRecipes(host);
    expect(hidden?.sign.pages).toBe('none');
    expect(first?.sign.pages).toBe('first');
    expect(first?.sign.spot).toMatchObject({ across: 0, down: 0 });
  });

  it('keeps a name once: saving under it again takes the place of the old one', () => {
    const first = [recipe('Scans', 'one'), recipe('Other', 'two')];
    const again = withRecipe(first, { ...recipe(' scans ', 'three'), folder: 'D:\\new' });
    expect(again.map((known) => [known.id, known.folder])).toEqual([['one', 'D:\\new'], ['two', 'C:\\out']]);
    expect(withRecipe(first, recipe('New', 'four'))).toHaveLength(3);
  });
});
