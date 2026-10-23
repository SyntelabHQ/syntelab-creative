import { useTranslation } from '@syntelab/i18n';
import { Icon } from '@syntelab/ui-kit';
import type { ToolLayout } from './layout';
import { SplitPanes } from './split-panes';
import styles from './tool-frame.module.css';

export interface EmptyToolProps {
  readonly layout: ToolLayout;
}

/** The frame of a tool that is not built yet: its panes and buttons are drawn, and do nothing. */
export function EmptyTool({ layout }: EmptyToolProps) {
  const t = useTranslation();

  /** A button of a pane, drawn only. */
  const drawn = (icon: string, label: string) => (
    <button type="button" className={styles.action} disabled>
      <Icon name={icon} size={13} />
      {t(label)}
    </button>
  );

  return (
    <>
      <div className={styles.options}>
        <Icon name="sliders" size={13} />
        <span>{t('dev.frame.options')}</span>
      </div>

      <SplitPanes
        layout={layout}
        first={
        <section className={styles.pane} aria-label={t('dev.frame.input')}>
          <div className={styles.paneHead}>
            <span className={styles.paneTitle}>{t('dev.frame.input')}</span>
            <span className={styles.spring} />
            {drawn('folder-open', 'dev.frame.openFile')}
            {drawn('paste', 'dev.frame.paste')}
            {drawn('eraser', 'dev.frame.clear')}
          </div>
          <div className={styles.blank}>{t('dev.frame.inputEmpty')}</div>
        </section>
        }
        second={
        <section className={styles.pane} aria-label={t('dev.frame.output')}>
          <div className={styles.paneHead}>
            <span className={styles.paneTitle}>{t('dev.frame.output')}</span>
            <span className={styles.spring} />
            {drawn('copy', 'dev.frame.copy')}
            {drawn('floppy-disk', 'dev.frame.saveFile')}
          </div>
          <div className={styles.blank}>{t('dev.frame.outputEmpty')}</div>
        </section>
        }
      />

      <div className={styles.status} role="status">
        <span>{t('dev.frame.notKept')}</span>
        <span className={styles.spring} />
        <span className={styles.last}>{t('dev.frame.notBuilt')}</span>
        <button type="button" className={styles.burn} disabled data-tooltip={t('dev.hint.burn')}>
          <Icon name="trash-can" size={12} />
          {t('dev.frame.burn')}
        </button>
      </div>
    </>
  );
}
