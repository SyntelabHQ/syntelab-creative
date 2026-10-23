import { describe, expect, it } from 'vitest';
import { canKeep, changedChoices, loadRecipes, movedStep, operationsOf, RECIPE_TOOLS, saveRecipes, withChanged, withRecipe } from './recipe-store';
import { initialValues, toolById } from '../tools/tool-definitions';
import type { Recipe, RecipeStep } from './recipe-store';

/** A step as it is kept: every choice of its tool, with the ones named here as given. */
function step(tool: string, chosen: Record<string, string | number | boolean> = {}): RecipeStep {
  const known = toolById(tool);
  if (!known) throw new Error(`no tool ${tool}`);
  return { tool, values: { ...initialValues(known), ...chosen } };
}

function storage() {
  const kept = new Map<string, unknown>();
  return { loadData: <T>(key: string) => kept.get(key) as T | undefined, saveData: (key: string, value: unknown) => void kept.set(key, JSON.parse(JSON.stringify(value))) };
}

const clean: Recipe = {
  id: 'r1',
  name: 'Clean a list',
  steps: [
    step('trimLines'), step('removeDuplicates', { ignoreSpaces: true }), step('sortLines', { by: 'natural' })
  ],
};

describe('a recipe being changed', () => {
  it('moves a step up or down, and nowhere past the ends', () => {
    const tools = (steps: Recipe['steps']) => steps.map((step) => step.tool);
    expect(tools(movedStep(clean.steps, 0, 1))).toEqual(['removeDuplicates', 'trimLines', 'sortLines']);
    expect(tools(movedStep(clean.steps, 2, -1))).toEqual(['trimLines', 'sortLines', 'removeDuplicates']);
    expect(movedStep(clean.steps, 0, -1)).toBe(clean.steps);
    expect(movedStep(clean.steps, 2, 1)).toBe(clean.steps);
  });

  it('is kept under its id, and never under the name of another', () => {
    const other: Recipe = { id: 'r2', name: 'Other', steps: clean.steps };
    const renamed = withChanged([clean, other], { ...clean, name: 'Tidy' });
    expect(renamed?.map((recipe) => recipe.name)).toEqual(['Tidy', 'Other']);
    expect(withChanged([clean, other], { ...clean, name: ' other ' })).toBeNull();
    expect(withChanged([clean], { ...clean, name: 'CLEAN A LIST' })?.[0]?.name).toBe('CLEAN A LIST');
    expect(withChanged([clean], other)?.length).toBe(2);
  });

  it('can be kept only with a name and steps that can be applied', () => {
    expect(canKeep('Clean', clean.steps)).toBe(true);
    expect(canKeep('  ', clean.steps)).toBe(false);
    expect(canKeep('Clean', [])).toBe(false);
    expect(canKeep('Clean', [{ tool: 'replace', values: { find: '' } }])).toBe(false);
    expect(canKeep('Clean', [{ tool: 'fillerText', values: {} }])).toBe(false);
    expect(RECIPE_TOOLS.some((tool) => tool.makes)).toBe(false);
    expect(RECIPE_TOOLS.length).toBeGreaterThan(15);
  });
});

describe('recipes', () => {
  it('are found again as they were saved', () => {
    const host = storage();
    saveRecipes(host, [clean]);
    expect(loadRecipes(host)).toEqual([clean]);
  });

  it('are made whole when read, and what is not a recipe is left out', () => {
    const host = storage();
    host.saveData('recipes', [
      { id: 'a', name: ' Old ', steps: [{ tool: 'sortLines', values: { by: 'nowhere', descending: 'yes', extra: 1 } }, { tool: 'gone' }, { tool: 'replace', values: { find: '' } }, { tool: 'tabsToSpaces', values: { width: 99 } }] },
      { id: 'b', name: 'Empty', steps: [{ tool: 'gone' }] },
      { id: 'c', steps: [] },
      'text',
    ]);
    const [old, ...rest] = loadRecipes(host);
    expect(rest).toHaveLength(0);
    expect(old?.name).toBe('Old');
    // A choice that is not one of the tool's is as the tool starts with; a tool that is gone, or cannot run, is left out.
    expect(old?.steps).toEqual([step('sortLines'), step('tabsToSpaces', { width: 16 })]);
  });

  it('keep a name once', () => {
    const again = withRecipe([clean], { ...clean, id: 'r2', name: ' clean A LIST ', steps: clean.steps.slice(0, 1) });
    expect(again.map((recipe) => [recipe.id, recipe.steps.length])).toEqual([['r1', 1]]);
    expect(withRecipe([clean], { ...clean, id: 'r3', name: 'Another' })).toHaveLength(2);
  });

  it('become the operations the Rust side runs, in order', () => {
    expect(operationsOf(clean.steps, 'ro')).toEqual([
      { kind: 'trimLines', side: 'both' },
      expect.objectContaining({ kind: 'removeDuplicates', keep: 'first', caseSensitive: false, ignoreSpaces: true, adjacentOnly: false, empty: 'asOthers' }),
      expect.objectContaining({ kind: 'sortLines', by: 'natural', descending: false, caseSensitive: false, language: 'ro', key: 'line' }),
    ]);
    expect(operationsOf([{ tool: 'gone', values: {} }], 'ro')).toEqual([]);
  });

  it('say of a step what was chosen for it', () => {
    expect(changedChoices(clean.steps[1]!)).toEqual([['ignoreSpaces', true]]);
    expect(changedChoices(clean.steps[2]!)).toEqual([['by', 'natural']]);
    expect(changedChoices({ tool: 'replace', values: { find: 'a', with: '', regex: false, caseSensitive: false, wholeWord: false, keepCase: false } })).toEqual([['find', 'a']]);
  });
});
