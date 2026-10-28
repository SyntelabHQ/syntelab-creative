import { searchItems } from '@syntelab/command-registry';
import { useTranslation } from '@syntelab/i18n';
import { Icon } from '@syntelab/ui-kit';
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { AppIcon, useAppTexts } from '../apps';
import styles from './command-palette.module.css';
import { useSearchItems } from './search-items';
import type { Found } from './search-items';
import { closePalette, usePaletteOpen } from './search-palette';

/** The most results listed: the nearest ones, not a page to scroll. */
const LISTED_MOST = 12;

export interface CommandPaletteProps {
  /** The tools of the app in front: listed before anything is typed, and found first. */
  readonly tools: readonly Found[];
}

/**
 * The search window, over the middle of the window: before anything is typed
 * it lists the tools of the app in front; as one types, it finds apps, tools
 * and commands. ↑ ↓ choose, Enter opens, Esc closes.
 */
export function CommandPalette({ tools }: CommandPaletteProps) {
  const open = usePaletteOpen();
  return open ? <Palette tools={tools} /> : null;
}

function Palette({ tools }: CommandPaletteProps) {
  const t = useTranslation();
  const appTexts = useAppTexts();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const all = useSearchItems();

  const typed = query.trim() !== '';
  const apps = all.filter((item) => item.id.startsWith('app:') && item.id.split(':').length === 2);
  // Nothing typed: the tools of the app in front, or, where there are none, the apps.
  const shown = typed ? searchItems([...tools, ...all], query, (item) => item.names).slice(0, LISTED_MOST) : tools.length > 0 ? tools : apps;
  const heading = typed ? null : tools.length > 0 ? t('shell.palette.tools') : t('shell.palette.apps');
  const optionId = (index: number) => `${listId}-${index}`;

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => before?.focus();
  }, []);

  const run = (item: Found) => {
    closePalette();
    item.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePalette();
      return;
    }
    if (shown.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % shown.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + shown.length) % shown.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = shown[activeIndex];
      if (item) run(item);
    }
  };

  return (
    <div className={styles.backdrop} onPointerDown={(event) => event.target === event.currentTarget && closePalette()}>
      <div role="dialog" aria-modal="true" aria-label={t('shell.search.placeholder')} className={styles.palette}>
        <div className={styles.field}>
          <Icon name="magnifying-glass" size={18} />
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            className={styles.input}
            aria-label={t('shell.search.placeholder')}
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={shown.length > 0 ? optionId(activeIndex) : undefined}
            placeholder={t('shell.palette.placeholder')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
          />
          <kbd className={styles.key}>Esc</kbd>
        </div>
        {heading && <div className={styles.heading}>{heading}</div>}
        <ul id={listId} role="listbox" className={styles.results}>
          {shown.map((item, index) => (
            <li key={item.id} id={optionId(index)} role="option" aria-selected={index === activeIndex} className={styles.option} onPointerMove={() => setActiveIndex(index)} onClick={() => run(item)}>
              <span className={styles.icon} aria-hidden="true" style={{ color: item.color }}>
                {item.app ? <AppIcon app={item.app} size={20} /> : item.icon && <Icon name={item.icon} size={16} />}
              </span>
              <span className={styles.label}>{item.label}</span>
              {item.app ? <span className={styles.detail}>{item.detail ?? appTexts.name(item.app)}</span> : item.detail && <span className={styles.detail}>{item.detail}</span>}
            </li>
          ))}
          {shown.length === 0 && (
            <li role="presentation" className={styles.empty}>
              {t('shell.search.noResults')}
            </li>
          )}
        </ul>
        <div className={styles.footer} aria-hidden="true">
          <span>
            <kbd className={styles.key}>↑</kbd>
            <kbd className={styles.key}>↓</kbd> {t('shell.palette.move')}
          </span>
          <span>
            <kbd className={styles.key}>Enter</kbd> {t('shell.palette.open')}
          </span>
          <span>
            <kbd className={styles.key}>Esc</kbd> {t('shell.palette.close')}
          </span>
        </div>
      </div>
    </div>
  );
}
