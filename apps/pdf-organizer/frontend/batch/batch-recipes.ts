import type { AppHost } from '@syntelab/shell-api';
import { BATCH_OUTPUTS, BATCH_STEPS, DEFAULT_JOB } from './batch-actions';
import type { BatchJob, BatchOutput } from './batch-actions';
import { readSignSettings } from './sign-settings';
import type { SignSettings } from './sign-settings';

/**
 * A recipe: everything chosen for a run except the files, kept under a name
 * so the same work can be started again with one choice ("Sign for the
 * company", "Scans for e-mail"). Kept on this computer. A password is never
 * part of one.
 */
export interface BatchRecipe {
  readonly id: string;
  readonly name: string;
  readonly job: BatchJob;
  readonly output: BatchOutput;
  /** What is added to each name; null for the usual one of the job. */
  readonly added: string | null;
  readonly oneName: string;
  readonly folder: string;
  readonly sign: SignSettings;
  /** The certificate of the computer that signs, and the look of the signatures; empty when none was chosen. */
  readonly certificateId: string;
  readonly presetId: string;
}

const KEY = 'batchRecipes';
const MOST_RECIPES = 30;

const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

/** One recipe read from storage, made whole; null when it is not one. */
function readRecipe(stored: unknown): BatchRecipe | null {
  if (typeof stored !== 'object' || stored === null) return null;
  const recipe = stored as Record<string, unknown>;
  if (typeof recipe.id !== 'string' || typeof recipe.name !== 'string' || recipe.name.trim() === '') return null;
  const job = (typeof recipe.job === 'object' && recipe.job !== null ? recipe.job : {}) as Partial<BatchJob>;
  return {
    id: recipe.id,
    name: recipe.name,
    job: { ...DEFAULT_JOB, ...job, steps: BATCH_STEPS.filter((step) => Array.isArray(job.steps) && job.steps.includes(step)) },
    output: BATCH_OUTPUTS.includes(recipe.output as BatchOutput) ? (recipe.output as BatchOutput) : 'each',
    added: typeof recipe.added === 'string' ? recipe.added : null,
    oneName: text(recipe.oneName),
    folder: text(recipe.folder),
    sign: readSignSettings(recipe.sign),
    certificateId: text(recipe.certificateId),
    presetId: text(recipe.presetId),
  };
}

export function loadRecipes(host: Pick<AppHost, 'loadData'>): BatchRecipe[] {
  const stored = host.loadData<unknown>(KEY);
  if (!Array.isArray(stored)) return [];
  return stored.map(readRecipe).filter((recipe): recipe is BatchRecipe => recipe !== null).slice(0, MOST_RECIPES);
}

export function saveRecipes(host: Pick<AppHost, 'saveData'>, recipes: readonly BatchRecipe[]): void {
  host.saveData(KEY, recipes.slice(0, MOST_RECIPES));
}

/** The recipes with one added, or put in place of the one of the same name (a name is kept once). */
export function withRecipe(recipes: readonly BatchRecipe[], recipe: BatchRecipe): BatchRecipe[] {
  const same = (known: BatchRecipe) => known.name.trim().toLowerCase() === recipe.name.trim().toLowerCase();
  const existing = recipes.find(same);
  return existing ? recipes.map((known) => (same(known) ? { ...recipe, id: existing.id } : known)) : [...recipes, recipe];
}
