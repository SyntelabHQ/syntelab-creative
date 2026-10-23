import { useTranslation } from '@syntelab/i18n';
import { Button, Icon } from '@syntelab/ui-kit';
import { useState } from 'react';
import shapeStyles from '../organize/shape-dialog.module.css';
import type { BatchRecipe } from './batch-recipes';
import styles from './batch-view.module.css';

export interface RecipeBarProps {
  readonly recipes: readonly BatchRecipe[];
  /** The id of the recipe the choices came from; empty when none. */
  readonly chosen: string;
  readonly onChoose: (recipe: BatchRecipe | null) => void;
  /** Keeps the choices as they are now under a name. */
  readonly onSave: (name: string) => void;
  readonly onDelete: () => void;
  readonly disabled: boolean;
}

/** The recipes: choose one to set everything as it was saved, save the choices as they are now, forget one. */
export function RecipeBar({ recipes, chosen, onChoose, onSave, onDelete, disabled }: RecipeBarProps) {
  const t = useTranslation();
  /** The name being typed for a recipe; null while none is being saved. */
  const [naming, setNaming] = useState<string | null>(null);
  const current = recipes.find((recipe) => recipe.id === chosen);

  return (
    <div className={styles.recipes}>
      <label className={styles.recipeChoice}>
        <span className={styles.recipeLabel}>
          <Icon name="bookmark" size={14} />
          {t('pdf-organizer.batch.recipe')}
        </span>
        <select className={shapeStyles.select} value={current?.id ?? ''} disabled={disabled} onChange={(event) => onChoose(recipes.find((recipe) => recipe.id === event.target.value) ?? null)}>
          <option value="">{t(recipes.length === 0 ? 'pdf-organizer.batch.recipe.noneYet' : 'pdf-organizer.batch.recipe.none')}</option>
          {recipes.map((recipe) => (
            <option key={recipe.id} value={recipe.id}>
              {recipe.name}
            </option>
          ))}
        </select>
      </label>
      {naming === null ? (
        <>
          <Button disabled={disabled} onClick={() => setNaming(current?.name ?? '')}>
            {t('pdf-organizer.batch.recipe.save')}
          </Button>
          {current && (
            <Button disabled={disabled} onClick={onDelete}>
              {t('pdf-organizer.batch.recipe.delete')}
            </Button>
          )}
        </>
      ) : (
        <form
          className={styles.recipeName}
          onSubmit={(event) => {
            event.preventDefault();
            if (naming.trim() === '') return;
            onSave(naming.trim());
            setNaming(null);
          }}
        >
          <input
            type="text"
            className={styles.field}
            dir="auto"
            maxLength={60}
            autoFocus
            value={naming}
            placeholder={t('pdf-organizer.batch.recipe.nameHint')}
            aria-label={t('pdf-organizer.batch.recipe.name')}
            onChange={(event) => setNaming(event.target.value)}
          />
          <Button type="submit" variant="primary" disabled={naming.trim() === ''}>
            {t('common.action.save')}
          </Button>
          <Button onClick={() => setNaming(null)}>{t('common.action.cancel')}</Button>
        </form>
      )}
    </div>
  );
}
