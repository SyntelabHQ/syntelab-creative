import type { CSSProperties } from 'react';
import { Icon } from '../icon/icon';
import styles from './tool-cards.module.css';

/** One card: a tool of an app, as its start page shows it. */
export interface ToolCard {
  readonly id: string;
  /** Already translated. */
  readonly name: string;
  /** What the tool is for, already translated. */
  readonly description?: string;
  /** Name of a file in `assets/icons/`. */
  readonly icon: string;
  /** One of the tool colors of the theme (`--sc-tool-<color>`), or none for the accent. */
  readonly color?: string;
  readonly disabled?: boolean;
  readonly onChoose: () => void;
}

export interface ToolCardsProps {
  /** Already translated; shown small above the cards. */
  readonly title?: string;
  readonly cards: readonly ToolCard[];
}

/** The tools of an app as cards, on its start page: a click opens the tool. */
export function ToolCards({ title, cards }: ToolCardsProps) {
  return (
    <section className={styles.section}>
      {title && <h2 className={styles.title}>{title}</h2>}
      <div className={styles.cards}>
        {cards.map((card) => (
          <button key={card.id} type="button" className={styles.card} disabled={card.disabled} style={card.color ? ({ '--card-color': `var(--sc-tool-${card.color})` } as CSSProperties) : undefined} onClick={card.onChoose}>
            <span className={styles.head}>
              <span className={styles.icon}>
                <Icon name={card.icon} size={16} />
              </span>
              <span className={styles.name}>{card.name}</span>
            </span>
            {card.description && <span className={styles.description}>{card.description}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
