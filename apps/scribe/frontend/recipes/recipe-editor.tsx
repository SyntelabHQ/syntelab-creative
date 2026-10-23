import { useTranslation } from '@syntelab/i18n';
import { Button, Icon, IconButton } from '@syntelab/ui-kit';
import { useState } from 'react';
import { initialValues, isReady, TOOL_GROUPS, toolById } from '../tools/tool-definitions';
import { ToolFields } from '../tools/tool-fields';
import { canKeep, MOST_STEPS, movedStep, RECIPE_TOOLS } from './recipe-store';
import type { RecipeStep } from './recipe-store';
import styles from './recipe-editor.module.css';

export interface RecipeEditorProps {
  /** What the recipe is when the editor opens: empty for a new one. */
  readonly name: string;
  readonly steps: readonly RecipeStep[];
  /** Keeps the recipe; false when another recipe has that name already. */
  readonly onSave: (name: string, steps: readonly RecipeStep[]) => boolean;
  readonly onCancel: () => void;
}

/**
 * A recipe being changed: its name, and its steps, each of which can be
 * moved, taken out or given other choices. Nothing is kept until "Save".
 */
export function RecipeEditor({ name: startName, steps: startSteps, onSave, onCancel }: RecipeEditorProps) {
  const t = useTranslation();
  const [name, setName] = useState(startName);
  const [steps, setSteps] = useState<readonly RecipeStep[]>(startSteps);
  /** The step whose choices are shown; null when none is. */
  const [open, setOpen] = useState<number | null>(startSteps.length === 0 ? null : 0);
  const [taken, setTaken] = useState(false);

  const move = (index: number, by: -1 | 1) => {
    setSteps(movedStep(steps, index, by));
    setOpen((shown) => (shown === index ? index + by : shown === index + by ? index : shown));
  };
  const remove = (index: number) => {
    setSteps(steps.filter((_, at) => at !== index));
    setOpen(null);
  };
  const add = (id: string) => {
    const tool = toolById(id);
    if (!tool || steps.length >= MOST_STEPS) return;
    setSteps([...steps, { tool: tool.id, values: initialValues(tool) }]);
    setOpen(steps.length);
  };

  return (
    <form
      className={styles.editor}
      onSubmit={(event) => {
        event.preventDefault();
        if (canKeep(name, steps)) setTaken(!onSave(name.trim(), steps));
      }}
    >
      <label className={styles.field}>
        <span>{t('scribe.recipes.name')}</span>
        <input
          type="text"
          className={styles.control}
          dir="auto"
          maxLength={60}
          autoFocus={startName === ''}
          value={name}
          placeholder={t('scribe.recipes.nameHint')}
          onChange={(event) => {
            setName(event.target.value);
            setTaken(false);
          }}
        />
      </label>
      {taken && (
        <p className={styles.problem} role="alert">
          {t('scribe.recipes.nameTaken')}
        </p>
      )}

      {steps.length === 0 && <p className={styles.note}>{t('scribe.recipes.noSteps')}</p>}
      <ol className={styles.steps}>
        {steps.map((step, index) => {
          const tool = toolById(step.tool);
          if (!tool) return null;
          const shown = open === index;
          const ready = isReady(tool, step.values);
          return (
            <li key={`${index}-${step.tool}`} className={styles.step} data-open={shown} data-ready={ready}>
              <div className={styles.stepHead}>
                <button type="button" className={styles.stepName} aria-expanded={shown} onClick={() => setOpen(shown ? null : index)}>
                  <span className={styles.number}>{index + 1}</span>
                  <span>{t(`scribe.tool.${tool.id}`)}</span>
                </button>
                <IconButton variant="ghost" aria-label={t('scribe.recipes.moveUp')} tooltipSide="bottom-end" disabled={index === 0} onClick={() => move(index, -1)}>
                  <Icon name="chevron-up" size={12} />
                </IconButton>
                <IconButton variant="ghost" aria-label={t('scribe.recipes.moveDown')} tooltipSide="bottom-end" disabled={index === steps.length - 1} onClick={() => move(index, 1)}>
                  <Icon name="chevron-down" size={12} />
                </IconButton>
                <IconButton variant="ghost" aria-label={t('scribe.recipes.removeStep')} tooltipSide="bottom-end" onClick={() => remove(index)}>
                  <Icon name="trash-can" size={12} />
                </IconButton>
              </div>
              {!ready && <p className={styles.problem}>{t('scribe.recipes.stepNotReady')}</p>}
              {shown && (
                <div className={styles.choices}>
                  {tool.fields.length === 0 && <p className={styles.note}>{t('scribe.recipes.noChoices')}</p>}
                  <ToolFields tool={tool} values={step.values} disabled={false} onChange={(values) => setSteps(steps.map((known, at) => (at === index ? { ...known, values } : known)))} />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {steps.length < MOST_STEPS && (
        <label className={styles.field}>
          <span>{t('scribe.recipes.addStep')}</span>
          {/* Always back on its first line: choosing a tool adds it. */}
          <select className={styles.control} value="" onChange={(event) => add(event.target.value)}>
            <option value="">{t('scribe.recipes.chooseTool')}</option>
            {TOOL_GROUPS.map((group) => {
              const tools = RECIPE_TOOLS.filter((tool) => tool.group === group);
              return (
                tools.length > 0 && (
                  <optgroup key={group} label={t(`scribe.toolGroup.${group}`)}>
                    {tools.map((tool) => (
                      <option key={tool.id} value={tool.id}>
                        {t(`scribe.tool.${tool.id}`)}
                      </option>
                    ))}
                  </optgroup>
                )
              );
            })}
          </select>
        </label>
      )}

      <span className={styles.buttons}>
        <Button type="submit" variant="primary" disabled={!canKeep(name, steps)}>
          {t('common.action.save')}
        </Button>
        <Button onClick={onCancel}>{t('common.action.cancel')}</Button>
      </span>
    </form>
  );
}
