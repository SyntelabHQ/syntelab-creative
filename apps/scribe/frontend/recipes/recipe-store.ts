import type { AppHost } from '@syntelab/shell-api';
import { initialValues, isReady, operationOf, toolById, TOOLS, visibleFields } from '../tools/tool-definitions';
import type { ToolValues } from '../tools/tool-definitions';

/** One step of a recipe: a tool with the choices it was applied with. */
export interface RecipeStep {
  /** The id of the tool (see `tool-definitions.ts`). */
  readonly tool: string;
  readonly values: ToolValues;
}

/**
 * A recipe: tools applied one after another, kept under a name, to be run
 * again on a text, on files or on a folder. Kept on this computer.
 */
export interface Recipe {
  readonly id: string;
  readonly name: string;
  readonly steps: readonly RecipeStep[];
}

/** The tools a recipe can be made of: those that change a text (the ones that write one are no step). */
export const RECIPE_TOOLS = TOOLS.filter((tool) => !tool.makes);

const KEY = 'recipes';
const MOST_RECIPES = 100;
export const MOST_STEPS = 50;

/** A step read from storage, made whole; null when its tool is not known (any more) or cannot be applied as it is. */
function readStep(stored: unknown): RecipeStep | null {
  if (typeof stored !== 'object' || stored === null) return null;
  const { tool: id, values } = stored as { tool?: unknown; values?: unknown };
  const tool = typeof id === 'string' ? toolById(id) : undefined;
  // A tool that writes a text changes none: it is no step of a recipe.
  if (!tool || tool.makes) return null;
  const given = typeof values === 'object' && values !== null ? (values as Record<string, unknown>) : {};
  // Only the choices the tool has, each of the kind it is; anything else is as the tool starts with.
  const whole: Record<string, string | number | boolean> = { ...initialValues(tool) };
  for (const field of tool.fields) {
    const value = given[field.name];
    if (field.kind === 'flag' && typeof value === 'boolean') whole[field.name] = value;
    if ((field.kind === 'text' || field.kind === 'lines') && typeof value === 'string') whole[field.name] = value;
    if (field.kind === 'number' && typeof value === 'number' && Number.isFinite(value)) whole[field.name] = Math.min(Math.max(Math.round(value), field.min), field.max);
    if ((field.kind === 'choice' || field.kind === 'language') && typeof value === 'string' && field.options.includes(value)) whole[field.name] = value;
  }
  return isReady(tool, whole) ? { tool: tool.id, values: whole } : null;
}

function readRecipe(stored: unknown): Recipe | null {
  if (typeof stored !== 'object' || stored === null) return null;
  const { id, name, steps } = stored as { id?: unknown; name?: unknown; steps?: unknown };
  if (typeof id !== 'string' || typeof name !== 'string' || name.trim() === '' || !Array.isArray(steps)) return null;
  const read = steps.map(readStep).filter((step): step is RecipeStep => step !== null).slice(0, MOST_STEPS);
  return read.length > 0 ? { id, name: name.trim(), steps: read } : null;
}

export function loadRecipes(host: Pick<AppHost, 'loadData'>): Recipe[] {
  const stored = host.loadData<unknown>(KEY);
  if (!Array.isArray(stored)) return [];
  return stored.map(readRecipe).filter((recipe): recipe is Recipe => recipe !== null).slice(0, MOST_RECIPES);
}

export function saveRecipes(host: Pick<AppHost, 'saveData'>, recipes: readonly Recipe[]): void {
  host.saveData(KEY, recipes.slice(0, MOST_RECIPES));
}

/** The recipes with one added, or put in place of the one of the same name (a name is kept once). */
export function withRecipe(recipes: readonly Recipe[], recipe: Recipe): Recipe[] {
  const same = (known: Recipe) => known.name.trim().toLowerCase() === recipe.name.trim().toLowerCase();
  const existing = recipes.find(same);
  return existing ? recipes.map((known) => (same(known) ? { ...recipe, id: existing.id } : known)) : [...recipes, recipe];
}

/**
 * The recipes with one changed (found by its id) or, when it is new, added. Null when another recipe has its
 * name already: a name is kept once, and changing a recipe never takes the place of another.
 */
export function withChanged(recipes: readonly Recipe[], recipe: Recipe): Recipe[] | null {
  const name = recipe.name.trim().toLowerCase();
  if (recipes.some((known) => known.id !== recipe.id && known.name.trim().toLowerCase() === name)) return null;
  return recipes.some((known) => known.id === recipe.id) ? recipes.map((known) => (known.id === recipe.id ? recipe : known)) : [...recipes, recipe];
}

/** The steps with one moved a place up (-1) or down (+1); as they were when it has nowhere to go. */
export function movedStep(steps: readonly RecipeStep[], index: number, by: -1 | 1): readonly RecipeStep[] {
  const to = index + by;
  const moved = steps[index];
  const other = steps[to];
  if (!moved || !other) return steps;
  return steps.map((step, at) => (at === index ? other : at === to ? moved : step));
}

/** True when a recipe can be kept: it has a name and steps, and each step can be applied as it is. */
export function canKeep(name: string, steps: readonly RecipeStep[]): boolean {
  return (
    name.trim() !== '' &&
    steps.length > 0 &&
    steps.length <= MOST_STEPS &&
    steps.every((step) => {
      const tool = toolById(step.tool);
      return tool !== undefined && !tool.makes && isReady(tool, step.values);
    })
  );
}

/** The operations the Rust side is asked for, in order. Steps whose tool is gone are left out. */
export function operationsOf(steps: readonly RecipeStep[], language: string): Record<string, unknown>[] {
  return steps.flatMap((step) => {
    const tool = toolById(step.tool);
    return tool ? [operationOf(tool, step.values, language)] : [];
  });
}

/** The choices of a step that are not as the tool starts with: what is worth saying about it in a line. */
export function changedChoices(step: RecipeStep): [string, string | number | boolean][] {
  const tool = toolById(step.tool);
  if (!tool) return [];
  const usual = initialValues(tool);
  return visibleFields(tool, step.values).map((field): [string, string | number | boolean] => [field.name, step.values[field.name] ?? field.initial]).filter(([name, value]) => value !== usual[name] && value !== '' && value !== false);
}
