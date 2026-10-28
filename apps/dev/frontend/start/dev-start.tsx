import { useTranslation } from '@syntelab/i18n';
import type { ToolEntry } from '@syntelab/shell-api';
import { Icon } from '@syntelab/ui-kit';
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { hand } from '../frame/handed';
import { GROUPS, TOOLS } from '../tools/catalog';
import type { Tool } from '../tools/catalog';
import styles from './dev-start.module.css';
import { recognize } from './recognize';

export interface DevStartProps {
  /** The pinned tools, in the order they were pinned. */
  readonly pins: readonly string[];
  readonly onPin: (id: string) => void;
  readonly onOpen: (id: string) => void;
  /** The menus of the tools as the list on the side shows them: each group of tools takes its icon and its color. */
  readonly menus: readonly ToolEntry[];
}

const plain = (text: string) => text.toLocaleLowerCase();

/**
 * The first page of Dev: a box to paste anything into, a search, the pinned
 * tools, and every tool under its menu. What is pasted is looked at and told
 * (a token, JSON, a timestamp…), and the tools that work on such a thing are
 * offered: one opens with the text already in it. The text is kept nowhere.
 */
export function DevStart({ pins, onPin, onOpen, menus }: DevStartProps) {
  const t = useTranslation();
  const [query, setQuery] = useState('');
  // Not kept between uses: what is pasted here is in memory until it is cleared or the tab is closed.
  const [pasted, setPasted] = useState('');
  const guesses = useMemo(() => recognize(pasted), [pasted]);
  const known = (id: string) => TOOLS.find((tool) => tool.id === id && !tool.later);
  const openWith = (id: string) => {
    hand(pasted);
    onOpen(id);
  };

  const sought = plain(query.trim());
  const found = (tool: Tool) => sought === '' || [t(`dev.tool.${tool.id}`), t(`dev.about.${tool.id}`), tool.id].some((text) => plain(text).includes(sought));
  const pinned = pins.flatMap((id) => TOOLS.find((tool) => tool.id === id && found(tool)) ?? []);

  const menuOf = (group: string) => menus.find((menu) => menu.menuKey === `dev.menu.${group}`);
  /** A group's color, as the list on the side shows it: its cards are in it. */
  const colorOf = (group: string): CSSProperties | undefined => {
    const color = menuOf(group)?.color;
    return color ? ({ '--dev-color': `var(--sc-tool-${color})` } as CSSProperties) : undefined;
  };

  const card = (tool: Tool) => (
    <li key={tool.id} className={styles.card} data-later={tool.later === true} style={colorOf(tool.group)}>
      <button type="button" className={styles.open} disabled={tool.later} onClick={() => onOpen(tool.id)}>
        <span className={styles.icon} aria-hidden="true">
          <Icon name={tool.icon} size={16} />
        </span>
        <span className={styles.texts}>
          <span className={styles.name}>{t(`dev.tool.${tool.id}`)}</span>
          <span className={styles.about}>{tool.later ? t('dev.hint.later') : t(`dev.about.${tool.id}`)}</span>
        </span>
      </button>
      {!tool.later && (
        <button type="button" className={styles.pin} aria-pressed={pins.includes(tool.id)} aria-label={t(pins.includes(tool.id) ? 'dev.start.unpin' : 'dev.start.pin')} data-tooltip={t(pins.includes(tool.id) ? 'dev.start.unpin' : 'dev.start.pin')} onClick={() => onPin(tool.id)}>
          <Icon name="bookmark" size={12} />
        </button>
      )}
    </li>
  );

  const groups = GROUPS.map((group) => ({ group, tools: TOOLS.filter((tool) => tool.group === group && found(tool)) })).filter(({ tools }) => tools.length > 0);

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <h1 className={styles.title}>{t('dev.start.title')}</h1>

        <div className={styles.paste}>
          <div className={styles.pasteHead}>
            <Icon name="paste" size={14} />
            <span className={styles.pasteTitle}>{t('dev.start.paste')}</span>
            {pasted !== '' && (
              <button type="button" className={styles.clear} onClick={() => setPasted('')}>
                <Icon name="eraser" size={12} />
                {t('dev.frame.clear')}
              </button>
            )}
          </div>
          <textarea className={styles.pasteBox} rows={3} value={pasted} spellCheck={false} placeholder={t('dev.start.pasteHint')} aria-label={t('dev.start.paste')} onChange={(event) => setPasted(event.target.value)} />
          {guesses.length > 0 && (
            <ul className={styles.guesses} aria-live="polite">
              {guesses.map((guess) => (
                <li key={guess.kind} className={styles.guess}>
                  <span className={styles.looks}>{t(`dev.start.looks.${guess.kind}`)}</span>
                  <span className={styles.offers}>
                    {guess.tools.flatMap((id) => {
                      const tool = known(id);
                      return tool ? (
                        <button key={id} type="button" className={styles.offer} onClick={() => openWith(id)}>
                          <Icon name={tool.icon} size={12} />
                          {t(`dev.tool.${id}`)}
                        </button>
                      ) : (
                        []
                      );
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className={styles.finder}>
          <Icon name="magnifying-glass" size={14} />
          <input type="search" value={query} placeholder={t('dev.start.find')} aria-label={t('dev.start.find')} onChange={(event) => setQuery(event.target.value)} />
        </label>

        {pinned.length > 0 && (
          <section className={styles.group}>
            <h2 className={styles.heading}>
              <Icon name="bookmark" size={12} />
              {t('dev.start.pinned')}
            </h2>
            <ul className={styles.grid}>{pinned.map(card)}</ul>
          </section>
        )}

        {groups.map(({ group, tools }) => (
          <section key={group} className={styles.group}>
            <h2 className={styles.heading}>
              <span className={styles.groupIcon} style={colorOf(group)} aria-hidden="true">
                <Icon name={menuOf(group)?.icon ?? 'wrench'} size={12} />
              </span>
              {t(`dev.menu.${group}`)}
              <span className={styles.count}>{tools.length}</span>
            </h2>
            <ul className={styles.grid}>{tools.map(card)}</ul>
          </section>
        ))}

        {groups.length === 0 && <p className={styles.none}>{t('dev.start.none')}</p>}
      </div>
    </div>
  );
}
