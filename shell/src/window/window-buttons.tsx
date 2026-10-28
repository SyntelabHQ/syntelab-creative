import { useTranslation } from '@syntelab/i18n';
import { tooltip } from '@syntelab/ui-kit';
import { useEffect, useState } from 'react';
import { drawsOwnTitleBar, minimizeWindow, requestCloseWindow, toggleMaximizeWindow, watchMaximized } from '../platform/window';
import styles from './window-buttons.module.css';

/**
 * The window's own buttons, at the end of the bar on top: the program draws
 * its title bar itself, so the tabs and the search stand in it. Drawn as the
 * system draws them: thin lines, the close button red under the pointer.
 * Nothing in the browser preview, which has no window of its own.
 */
export function WindowButtons() {
  const t = useTranslation();
  const [maximized, setMaximized] = useState(false);
  useEffect(() => watchMaximized(setMaximized), []);
  if (!drawsOwnTitleBar()) return null;

  const named = (name: string) => ({ 'aria-label': name, ...tooltip(name, 'bottom-end') });
  return (
    <div className={styles.buttons}>
      <button type="button" className={styles.button} {...named(t('shell.window.minimize'))} onClick={() => void minimizeWindow()}>
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <path d="M0 5.5h10" />
        </svg>
      </button>
      <button type="button" className={styles.button} {...named(t(maximized ? 'shell.window.restore' : 'shell.window.maximize'))} onClick={() => void toggleMaximizeWindow()}>
        {maximized ? (
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
            <path d="M2.5 2.5V0.5h7v7h-2M0.5 2.5h7v7h-7z" />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
            <path d="M0.5 0.5h9v9h-9z" />
          </svg>
        )}
      </button>
      <button type="button" className={styles.button} data-close="true" {...named(t('shell.window.close'))} onClick={() => void requestCloseWindow()}>
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
        </svg>
      </button>
    </div>
  );
}
