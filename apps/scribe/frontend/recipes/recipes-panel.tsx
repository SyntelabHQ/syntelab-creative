import { useI18n } from '@syntelab/i18n';
import { AppInvokeError, fileName } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';
import { Button, Icon } from '@syntelab/ui-kit';
import { useState } from 'react';
import { RecipeEditor } from './recipe-editor';
import { changedChoices, loadRecipes, operationsOf, saveRecipes, withChanged, withRecipe } from './recipe-store';
import type { Recipe, RecipeStep } from './recipe-store';
import { languageName } from '../tools/tool-field';
import styles from './recipes-panel.module.css';

export interface RecipesPanelProps {
  readonly host: Pick<AppHost, 'invoke' | 'loadData' | 'saveData' | 'pickFiles' | 'pickFolder'>;
  /** The tools applied to this text since it was opened, in order: what can be kept as a recipe. */
  readonly applied: readonly RecipeStep[];
  readonly onForgetApplied: () => void;
  /** Gives what a recipe would be run on right now: the selection when there is one, else the whole text. */
  readonly target: () => { readonly text: string; readonly selection: boolean };
  /** Puts the result in place of what the recipe was run on, as one step that can be undone. */
  readonly onApply: (text: string) => void;
  readonly disabled: boolean;
}

/** A file a recipe is run on, with the folders it came with. */
interface Source {
  readonly path: string;
  readonly under: string;
}

/** How a file went, as `run_on_files` says. */
interface Ran {
  readonly path: string;
  readonly written: string | null;
  readonly changed: number;
  readonly problem: string | null;
}

/** What is said under a recipe after it ran. */
type Said = { readonly kind: 'text'; readonly changed: number } | { readonly kind: 'files'; readonly ran: readonly Ran[] } | { readonly kind: 'problem'; readonly key: string; readonly detail?: string };

/** One step in a line: the tool, and the choices that are not its usual ones. */
function StepLine({ step }: { step: RecipeStep }) {
  const { t, has, language } = useI18n();
  const choices = changedChoices(step).map(([name, value]) => {
    const own = `scribe.field.${step.tool}.${name}`;
    const label = t(has(own) ? own : `scribe.field.${name}`);
    if (typeof value === 'boolean') return label;
    if (name === 'language' && typeof value === 'string') return `${label}: ${languageName(value, language)}`;
    const own_option = `scribe.option.${step.tool}.${name}.${value}`;
    const option = has(own_option) ? own_option : `scribe.option.${name}.${value}`;
    return `${label}: ${typeof value === 'string' && has(option) ? t(option) : value}`;
  });
  return (
    <li>
      <span className={styles.stepName}>{t(`scribe.tool.${step.tool}`)}</span>
      {choices.length > 0 && <bdi className={styles.stepChoices}>{choices.join(' · ')}</bdi>}
    </li>
  );
}

/**
 * Recipes, in the panel beside the text: the tools applied to this text can
 * be kept under a name; a kept recipe is run again on the text, or on files
 * and folders, whose results go over the files or into a folder of their own.
 */
export function RecipesPanel({ host, applied, onForgetApplied, target, onApply, disabled }: RecipesPanelProps) {
  const { t, language } = useI18n();
  const { invoke } = host;
  const [recipes, setRecipes] = useState<readonly Recipe[]>(() => loadRecipes(host));
  /** The name being typed for what was applied; null while it is not being saved. */
  const [naming, setNaming] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  /** The recipe being changed: its id, `new` for one made from nothing, null when none is. */
  const [editing, setEditing] = useState<string | null>(null);
  const [sources, setSources] = useState<readonly Source[]>([]);
  /** Where the results of a run on files go: null for over the files themselves. */
  const [folder, setFolder] = useState<string | null>(null);
  const [inPlace, setInPlace] = useState(false);
  const [working, setWorking] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);

  const store = (next: readonly Recipe[]) => {
    setRecipes(next);
    saveRecipes(host, next);
  };

  const fail = (error: unknown) => {
    const code = error instanceof AppInvokeError ? error.code : null;
    setSaid(code === 'bad-pattern' ? { kind: 'problem', key: 'scribe.tools.badPattern', detail: error instanceof Error ? error.message.replace(/^bad-pattern:\s*/, '') : undefined } : { kind: 'problem', key: 'scribe.tools.failed' });
  };

  const runOnText = async (recipe: Recipe) => {
    const { text } = target();
    setWorking(true);
    setSaid(null);
    try {
      const answer = await invoke<{ text: string; changed: number }>('apply', { text, operations: operationsOf(recipe.steps, language) });
      if (answer.text !== text) onApply(answer.text);
      setSaid({ kind: 'text', changed: answer.changed });
    } catch (error) {
      fail(error);
    } finally {
      setWorking(false);
    }
  };

  const addFiles = async () => {
    const picked = await host.pickFiles({ typeName: t('scribe.file.anyType'), extensions: ['*'], multiple: true });
    setSources((current) => [...current, ...picked.filter((path) => !current.some((known) => known.path === path)).map((path) => ({ path, under: '' }))]);
  };
  const addFolder = async () => {
    const picked = await host.pickFolder();
    if (picked === null) return;
    const found = await invoke<{ files: Source[] }>('list_text_files', { folder: picked }).catch(() => ({ files: [] }));
    setSources((current) => [...current, ...found.files.filter((file) => !current.some((known) => known.path === file.path))]);
  };
  const chooseFolder = async () => {
    const picked = await host.pickFolder();
    if (picked !== null) setFolder(picked);
  };

  const runOnFiles = async (recipe: Recipe) => {
    setWorking(true);
    setSaid(null);
    try {
      const answer = await invoke<{ files: Ran[] }>('run_on_files', { files: sources, operations: operationsOf(recipe.steps, language), ...(inPlace ? {} : { folder }) });
      setSaid({ kind: 'files', ran: answer.files });
    } catch (error) {
      fail(error);
    } finally {
      setWorking(false);
    }
  };

  const openRecipe = (id: string | null) => {
    setOpen(id);
    setEditing(null);
    setSaid(null);
  };

  /** Keeps a recipe that was changed or made in the editor; false when its name is another recipe's. */
  const keep = (id: string, name: string, steps: readonly RecipeStep[]) => {
    const next = withChanged(recipes, { id, name, steps });
    if (next === null) return false;
    store(next);
    openRecipe(id);
    return true;
  };

  return (
    <div className={styles.recipes}>
      {applied.length > 0 && (
        <section className={styles.applied}>
          <h3 className={styles.heading}>{t('scribe.recipes.applied', { count: applied.length })}</h3>
          <ol className={styles.steps}>
            {applied.map((step, index) => (
              <StepLine key={index} step={step} />
            ))}
          </ol>
          {naming === null ? (
            <span className={styles.buttons}>
              <Button variant="primary" onClick={() => setNaming('')}>
                {t('scribe.recipes.keep')}
              </Button>
              <Button onClick={onForgetApplied}>{t('scribe.recipes.forget')}</Button>
            </span>
          ) : (
            <form
              className={styles.naming}
              onSubmit={(event) => {
                event.preventDefault();
                if (naming.trim() === '') return;
                const next = withRecipe(recipes, { id: `recipe-${Date.now().toString(36)}`, name: naming.trim(), steps: applied });
                store(next);
                setNaming(null);
                onForgetApplied();
                openRecipe(next.find((recipe) => recipe.name === naming.trim())?.id ?? null);
              }}
            >
              <input type="text" className={styles.control} dir="auto" maxLength={60} autoFocus value={naming} placeholder={t('scribe.recipes.nameHint')} aria-label={t('scribe.recipes.name')} onChange={(event) => setNaming(event.target.value)} />
              <span className={styles.buttons}>
                <Button type="submit" variant="primary" disabled={naming.trim() === ''}>
                  {t('common.action.save')}
                </Button>
                <Button onClick={() => setNaming(null)}>{t('common.action.cancel')}</Button>
              </span>
            </form>
          )}
        </section>
      )}

      {recipes.length === 0 && applied.length === 0 && editing === null && <p className={styles.lead}>{t('scribe.recipes.none')}</p>}

      {editing === 'new' ? (
        <section className={styles.applied}>
          <h3 className={styles.heading}>{t('scribe.recipes.new')}</h3>
          <RecipeEditor name="" steps={[]} onSave={(name, steps) => keep(`recipe-${Date.now().toString(36)}`, name, steps)} onCancel={() => setEditing(null)} />
        </section>
      ) : (
        <span className={styles.buttons}>
          <Button
            onClick={() => {
              setOpen(null);
              setEditing('new');
            }}
          >
            {t('scribe.recipes.new')}
          </Button>
        </span>
      )}

      <div className={styles.list}>
        {recipes.map((recipe) => {
          const shown = recipe.id === open;
          const written = said?.kind === 'files' ? said.ran.filter((file) => file.written !== null) : [];
          const failed = said?.kind === 'files' ? said.ran.filter((file) => file.problem !== null) : [];
          const untouched = said?.kind === 'files' ? said.ran.length - written.length - failed.length : 0;
          return (
            <div key={recipe.id} className={styles.recipe} data-open={shown}>
              <button type="button" className={styles.recipeName} aria-expanded={shown} onClick={() => openRecipe(shown ? null : recipe.id)}>
                <Icon name={shown ? 'chevron-down' : 'chevron-right'} size={12} />
                <bdi>{recipe.name}</bdi>
                <span className={styles.count}>{t('scribe.recipes.steps', { count: recipe.steps.length })}</span>
              </button>
              {shown && editing === recipe.id && (
                <div className={styles.body}>
                  <RecipeEditor name={recipe.name} steps={recipe.steps} onSave={(name, steps) => keep(recipe.id, name, steps)} onCancel={() => setEditing(null)} />
                </div>
              )}
              {shown && editing !== recipe.id && (
                <div className={styles.body}>
                  <ol className={styles.steps}>
                    {recipe.steps.map((step, index) => (
                      <StepLine key={index} step={step} />
                    ))}
                  </ol>
                  <span className={styles.buttons}>
                    <Button variant="primary" disabled={disabled || working} onClick={() => void runOnText(recipe)}>
                      {t('scribe.recipes.runOnText')}
                    </Button>
                    <Button disabled={working} onClick={() => setEditing(recipe.id)}>
                      {t('scribe.recipes.change')}
                    </Button>
                    <Button
                      onClick={() => {
                        store(recipes.filter((known) => known.id !== recipe.id));
                        openRecipe(null);
                      }}
                    >
                      {t('scribe.recipes.delete')}
                    </Button>
                  </span>

                  <section className={styles.files}>
                    <h4 className={styles.filesHeading}>{t('scribe.recipes.onFiles')}</h4>
                    <span className={styles.buttons}>
                      <Button disabled={working} onClick={() => void addFiles()}>
                        {t('scribe.recipes.addFiles')}
                      </Button>
                      <Button disabled={working} onClick={() => void addFolder()}>
                        {t('scribe.recipes.addFolder')}
                      </Button>
                      {sources.length > 0 && (
                        <Button disabled={working} onClick={() => setSources([])}>
                          {t('scribe.recipes.clearFiles')}
                        </Button>
                      )}
                    </span>
                    {sources.length > 0 && (
                      <>
                        <p className={styles.note}>{t('scribe.recipes.files', { count: sources.length })}</p>
                        <label className={styles.choice}>
                          <input type="radio" checked={!inPlace} onChange={() => setInPlace(false)} />
                          {t('scribe.recipes.toFolder')}
                        </label>
                        {!inPlace && (
                          <span className={styles.folderRow}>
                            <bdi className={styles.folder} dir="ltr" title={folder ?? undefined}>
                              {folder ?? t('scribe.folder.noFolder')}
                            </bdi>
                            <Button disabled={working} onClick={() => void chooseFolder()}>
                              {t('scribe.folder.choose')}
                            </Button>
                          </span>
                        )}
                        <label className={styles.choice}>
                          <input type="radio" checked={inPlace} onChange={() => setInPlace(true)} />
                          {t('scribe.recipes.inPlace')}
                        </label>
                        {inPlace && <p className={styles.warning}>{t('scribe.recipes.inPlaceNote')}</p>}
                        <Button variant="primary" disabled={working || (!inPlace && folder === null)} onClick={() => void runOnFiles(recipe)}>
                          {t(working ? 'scribe.tools.working' : 'scribe.recipes.runOnFiles', { count: sources.length })}
                        </Button>
                      </>
                    )}
                  </section>

                  {said?.kind === 'text' && (
                    <p className={styles.done} role="status">
                      {t(said.changed === 0 ? 'scribe.tools.nothingChanged' : 'scribe.recipes.ranOnText')}
                    </p>
                  )}
                  {said?.kind === 'files' && (
                    <div className={styles.done} role="status">
                      <p>{t('scribe.recipes.ranOnFiles', { written: written.length, untouched })}</p>
                      {failed.length > 0 && (
                        <ul className={styles.failed}>
                          {failed.map((file) => (
                            <li key={file.path}>
                              <bdi>{fileName(file.path)}</bdi>: {t(`scribe.recipes.problem.${file.problem}`)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {said?.kind === 'problem' && (
                    <p className={styles.warning} role="alert">
                      {t(said.key)}
                      {said.detail && <bdi dir="ltr"> {said.detail}</bdi>}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
