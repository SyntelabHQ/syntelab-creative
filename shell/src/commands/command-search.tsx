import { searchItems } from '@syntelab/command-registry';
import { useI18n } from '@syntelab/i18n';
import { Icon, useDismiss } from '@syntelab/ui-kit';
import { useCallback, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { AppIcon, useAppTexts } from '../apps';
import styles from './command-search.module.css';
import { useSearchItems } from './search-items';
import type { Found } from './search-items';

/** The most results listed: the nearest ones, not a page to scroll. */
const LISTED_MOST = 12;

/** The search of the app switcher: results appear under it as one types. */
export function CommandSearch() {
  const { t } = useI18n();
  const appTexts = useAppTexts();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const found = useSearchItems();
  const results = searchItems(found, query, (item) => item.names).slice(0, LISTED_MOST);
  const open = query.trim() !== '';
  const optionId = (index: number) => `${listId}-${index}`;

  const close = useCallback(() => setQuery(''), []);
  useDismiss(containerRef, open, close);

  const run = (item: Found) => {
    close();
    item.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = results[activeIndex];
      if (item) run(item);
    }
  };

  return (
    <div ref={containerRef} className={styles.search}>
      <span className={styles.icon}>
        <Icon name="magnifying-glass" size={18} />
      </span>
      <input
        type="search"
        role="combobox"
        className={styles.input}
        aria-label={t('shell.search.placeholder')}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results.length > 0 ? optionId(activeIndex) : undefined}
        placeholder={t('shell.search.placeholder')}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={onKeyDown}
      />
      <ul id={listId} role="listbox" className={styles.results} hidden={!open}>
        {results.map((item, index) => (
          <li key={item.id} id={optionId(index)} role="option" aria-selected={index === activeIndex} className={styles.option} onPointerEnter={() => setActiveIndex(index)} onClick={() => run(item)}>
            {item.app ? (
              <span className={styles.app} aria-hidden="true">
                <AppIcon app={item.app} size={18} />
              </span>
            ) : (
              <span className={styles.app} aria-hidden="true">
                {item.icon && <Icon name={item.icon} size={16} />}
              </span>
            )}
            <span className={styles.label}>{item.label}</span>
            {/* An app says what it is for; a thing of an app says whose it is; a command, the tool it belongs to. */}
            {item.app ? <span className={styles.detail}>{item.detail ?? appTexts.name(item.app)}</span> : item.detail && <span className={styles.detail}>{item.detail}</span>}
          </li>
        ))}
        {open && results.length === 0 && (
          <li role="presentation" className={styles.empty}>
            {t('shell.search.noResults')}
          </li>
        )}
      </ul>
    </div>
  );
}
