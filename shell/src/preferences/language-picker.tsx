import { baseLanguage, useI18n } from '@syntelab/i18n';
import { Icon, placePopup, tooltip, useDismiss } from '@syntelab/ui-kit';
import type { PopupPlace } from '@syntelab/ui-kit';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  availableLanguages,
  languageName,
  languageRegistry,
  searchLanguages,
  SYSTEM_LANGUAGE,
  systemLanguage,
  translatedLanguageName,
} from '../i18n';
import type { LanguageOption } from '../i18n';
import { useStore } from '../state/create-store';
import styles from './language-picker.module.css';
import pickerStyles from './pickers.module.css';
import { preferences, updatePreferences } from './preferences-store';

/** How tall the open list is at most: the search field and up to 320 pixels of languages. */
const POPUP_HEIGHT = 380;
/** How wide the list under the quick form's button is. */
const COMPACT_WIDTH = 340;

/**
 * The language of the program: a list that can be searched. Every planned
 * language is listed, in the order of `locales/languages.json`; the ones not
 * translated yet are shown but cannot be chosen. Each row has the language's
 * own name and, under it, its name in the language the program is shown in.
 *
 * `compact` is the quick form for a bar: a button with the two letters of the
 * language in use, whose list opens under it.
 */
export function LanguagePicker({ compact = false }: { readonly compact?: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { language } = useStore(preferences);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [place, setPlace] = useState<PopupPlace | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const labelId = useId();
  const listId = useId();

  const options = useMemo<LanguageOption[]>(() => {
    const system: LanguageOption = {
      code: SYSTEM_LANGUAGE,
      native: t('shell.settings.languageSystemShort'),
      translated: languageName(systemLanguage()),
      english: 'System language',
      available: true,
    };
    const planned = languageRegistry.languages.map((entry) => ({
      code: entry.code,
      native: entry.native,
      translated: translatedLanguageName(entry.code, i18n),
      english: entry.english,
      available: availableLanguages.includes(entry.code),
    }));
    return [system, ...planned];
  }, [i18n, t]);

  const shown = useMemo(() => searchLanguages(options, query), [options, query]);
  const current = options.find((option) => option.code === language) ?? options[0];

  const close = (returnFocus: boolean) => {
    setOpen(false);
    setQuery('');
    if (returnFocus) buttonRef.current?.focus();
  };
  useDismiss(rootRef, open, () => close(false));

  // Opening, and every change of the search, starts from the chosen language
  // when it is in the list, else from the first one that can be chosen.
  useEffect(() => {
    if (!open) return;
    const chosen = shown.findIndex((option) => option.code === language);
    setActiveIndex(chosen >= 0 ? chosen : Math.max(0, shown.findIndex((option) => option.available)));
  }, [open, shown, language]);

  // The list is placed against the window, under or above the button: it never makes the page longer, so opening it
  // brings no scrollbar and moves nothing. It follows the button when the window changes or the page scrolls.
  useLayoutEffect(() => {
    if (!open) return;
    const follow = () => {
      const button = buttonRef.current?.getBoundingClientRect();
      if (!button) return;
      const window = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
      setPlace(placePopup(button, POPUP_HEIGHT, window, compact ? { width: COMPACT_WIDTH, align: 'end', rightToLeft: i18n.direction === 'rtl' } : {}));
    };
    follow();
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    return () => {
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
    };
  }, [open, compact, i18n.direction]);

  useEffect(() => {
    if (open) listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const choose = (option: LanguageOption | undefined) => {
    if (!option?.available) return;
    updatePreferences({ language: option.code });
    close(true);
  };

  /** The next row that can be chosen, going up or down from the active one. */
  const step = (direction: 1 | -1) => {
    for (let index = activeIndex + direction; index >= 0 && index < shown.length; index += direction) {
      if (shown[index]?.available) {
        setActiveIndex(index);
        return;
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') step(1);
    else if (event.key === 'ArrowUp') step(-1);
    else if (event.key === 'Enter') choose(shown[activeIndex]);
    else if (event.key === 'Escape') close(true);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const rowId = (index: number) => `${listId}-${index}`;

  const toggle = () => (open ? close(false) : setOpen(true));
  const label = t('shell.settings.language');

  const picker = (
      <div ref={rootRef} className={styles.picker}>
        {compact ? (
          <button
            ref={buttonRef}
            type="button"
            className={styles.iconButton}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={label}
            // The tooltip would cover the open list.
            {...(open ? {} : tooltip(`${label}: ${current?.code === SYSTEM_LANGUAGE ? current.translated : current?.native}`, 'bottom-end'))}
            onClick={toggle}
          >
            {/* The two letters of the language in use: "EN", "RO". */}
            <span className={styles.code2} lang="en">
              {baseLanguage(i18n.language).toUpperCase()}
            </span>
          </button>
        ) : (
          <button
            ref={buttonRef}
            type="button"
            className={styles.button}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-labelledby={labelId}
            onClick={toggle}
          >
            <LanguageNames option={current} />
            <Icon name="chevron-down" size={14} />
          </button>
        )}

        {open && (
          <div className={styles.popup} style={place ?? { visibility: 'hidden' }}>
            <label className={styles.search}>
              <Icon name="magnifying-glass" size={14} />
              <input
                // The list was opened to pick a language: typing starts at once.
                autoFocus
                type="text"
                role="combobox"
                className={styles.input}
                value={query}
                placeholder={t('shell.settings.languageSearch')}
                aria-label={t('shell.settings.languageSearch')}
                aria-expanded
                aria-controls={listId}
                aria-activedescendant={shown[activeIndex] ? rowId(activeIndex) : undefined}
                aria-autocomplete="list"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
              />
            </label>
            <ul ref={listRef} id={listId} role="listbox" aria-label={label} className={styles.list}>
              {shown.map((option, index) => (
                <li
                  key={option.code}
                  id={rowId(index)}
                  role="option"
                  className={styles.option}
                  aria-selected={option.code === language}
                  aria-disabled={!option.available}
                  data-active={index === activeIndex}
                  onPointerMove={() => option.available && setActiveIndex(index)}
                  onClick={() => choose(option)}
                >
                  <LanguageNames option={option} />
                  <span className={styles.side}>
                    {option.code !== SYSTEM_LANGUAGE && <span className={styles.code}>{option.code}</span>}
                    {!option.available && <span className={styles.soon}>{t('shell.app.comingSoon')}</span>}
                  </span>
                </li>
              ))}
              {shown.length === 0 && <li className={styles.empty}>{t('shell.settings.languageNone')}</li>}
            </ul>
          </div>
        )}
      </div>
  );

  if (compact) return picker;
  return (
    <section className={pickerStyles.field}>
      <span id={labelId} className={pickerStyles.label}>
        {label}
      </span>
      {picker}
    </section>
  );
}

/** A language's own name and, under it, its name in the program's language. */
function LanguageNames({ option }: { readonly option: LanguageOption | undefined }) {
  if (!option) return null;
  const isSystem = option.code === SYSTEM_LANGUAGE;
  return (
    <span className={styles.names}>
      <bdi className={styles.native} lang={isSystem ? undefined : option.code}>
        {option.native}
      </bdi>
      <bdi className={styles.translated}>{option.translated}</bdi>
    </span>
  );
}
