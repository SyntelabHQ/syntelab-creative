import { useTranslation } from '@syntelab/i18n';
import type { AppEntry } from '@syntelab/shell-api';
import { Button, Icon } from '@syntelab/ui-kit';
import { useId } from 'react';
import { useStore } from '../state/create-store';
import styles from './layout-picker.module.css';
import pickerStyles from './pickers.module.css';
import { clearAppLayout, LAYOUTS, PANEL_SIDES, preferences, resolveAppLayout, RIBBON_MODES, setAppLayout, setGlobalLayout } from './preferences-store';
import type { AppLayoutChoice, Layout, PanelSide } from './preferences-store';

const LAYOUT_KEYS: Record<Layout, { name: string; description: string }> = {
  classic: { name: 'shell.layout.classic', description: 'shell.layout.classicHint' },
  ribbon: { name: 'shell.layout.ribbon', description: 'shell.layout.ribbonHint' },
  'side-panel': { name: 'shell.layout.sidePanel', description: 'shell.layout.sidePanelHint' },
};

const SIDE_KEYS: Record<PanelSide, string> = {
  left: 'shell.layout.panelLeft',
  right: 'shell.layout.panelRight',
};

export interface LayoutPickerProps {
  /**
   * Without an app: the layout of the whole suite, which every app follows.
   * With an app: the layout of that app only, which overrides the suite's.
   */
  readonly app?: AppEntry;
}

/** Chooses between the three layouts, each with a small drawing of itself. */
export function LayoutPicker({ app }: LayoutPickerProps) {
  const t = useTranslation();
  const { appLayouts, globalLayout } = useStore(preferences);
  const groupId = useId();
  const sideId = useId();
  const modeId = useId();

  const own = app ? appLayouts[app.manifest.id] : undefined;
  const overrides = own?.layout !== undefined || own?.panelSide !== undefined || own?.ribbonMode !== undefined;
  // What is in use: for the suite, as if an app with no choice and no default of its own asked.
  const { layout, panelSide, ribbonMode } = resolveAppLayout(app ? appLayouts : {}, app?.manifest.id ?? '', app?.manifest.defaultLayout, globalLayout);
  const choose = (change: AppLayoutChoice) => (app ? setAppLayout(app.manifest.id, change) : setGlobalLayout(change));

  return (
    <section className={styles.picker}>
      {app && (
        <div className={styles.override}>
          <p id={groupId} className={styles.overrideNote}>
            {t(overrides ? 'shell.layout.overrides' : 'shell.layout.followsGlobal')}
          </p>
          <Button disabled={!overrides} onClick={() => clearAppLayout(app.manifest.id)}>
            <Icon name="arrow-rotate-left" size={14} />
            {t('shell.layout.useGlobal')}
          </Button>
        </div>
      )}
      <div role="radiogroup" aria-labelledby={app ? groupId : undefined} aria-label={app ? undefined : t('shell.settings.layout')} className={styles.cards}>
        {LAYOUTS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={layout === option}
            className={styles.card}
            onClick={() => choose({ layout: option })}
          >
            {/* The drawing is the same in every language and direction. */}
            <span className={styles.preview} data-layout={option} data-side={panelSide} aria-hidden="true">
              <span className={styles.tools} />
              <span className={styles.page} />
            </span>
            <span className={styles.name}>{t(LAYOUT_KEYS[option].name)}</span>
            <span className={styles.description}>{t(LAYOUT_KEYS[option].description)}</span>
          </button>
        ))}
      </div>

      {layout === 'ribbon' && (
        <div className={styles.side}>
          <span id={modeId} className={styles.sideLabel}>
            {t('shell.ribbon.form')}
          </span>
          <div role="radiogroup" aria-labelledby={modeId} className={pickerStyles.pills}>
            {RIBBON_MODES.map((mode) => (
              <button key={mode} type="button" role="radio" aria-checked={ribbonMode === mode} className={pickerStyles.pill} onClick={() => choose({ ribbonMode: mode })}>
                {t(`shell.ribbon.mode.${mode}`)}
              </button>
            ))}
          </div>
          <span className={styles.sideNote}>{t(`shell.ribbon.mode.${ribbonMode}Hint`)}</span>
        </div>
      )}

      {layout === 'side-panel' && (
        <div className={styles.side}>
          <span id={sideId} className={styles.sideLabel}>
            {t('shell.layout.panelSide')}
          </span>
          <div role="radiogroup" aria-labelledby={sideId} className={pickerStyles.pills}>
            {PANEL_SIDES.map((side) => (
              <button
                key={side}
                type="button"
                role="radio"
                aria-checked={panelSide === side}
                className={pickerStyles.pill}
                onClick={() => choose({ panelSide: side })}
              >
                {t(SIDE_KEYS[side])}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
