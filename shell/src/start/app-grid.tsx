import { useI18n } from '@syntelab/i18n';
import type { AppEntry } from '@syntelab/shell-api';
import { Icon, MenuButton, tooltip } from '@syntelab/ui-kit';
import { useId, useState } from 'react';
import type { DragEvent, KeyboardEvent } from 'react';
import { appColor, appInk, AppIcon, moveApp, useApps, useAppTexts } from '../apps';
import { APPS_VIEWS, preferences, updatePreferences } from '../preferences';
import type { AppsView } from '../preferences';
import { useStore } from '../state/create-store';
import { tabs } from '../tabs';
import styles from './app-grid.module.css';

const VIEW_OPTIONS: Record<AppsView, { labelKey: string; icon: string }> = {
  cards: { labelKey: 'shell.start.viewCards', icon: 'address-card' },
  'named-icons': { labelKey: 'shell.start.viewNamedIcons', icon: 'table-cells-large' },
  icons: { labelKey: 'shell.start.viewIcons', icon: 'grip' },
};

interface AppItemProps {
  readonly app: AppEntry;
  readonly view: AppsView;
}

/** One app, drawn as a card, an icon with its name, or just an icon. */
function AppItem({ app, view }: AppItemProps) {
  const { t } = useI18n();
  const appTexts = useAppTexts();
  const ready = app.manifest.status === 'active';
  const name = appTexts.name(app);
  const iconSize = view === 'cards' ? 34 : 30;

  const body = (
    <>
      <span className={styles.icon} style={ready ? { background: appColor(app) } : undefined}>
        <AppIcon app={app} size={iconSize} />
      </span>
      {view !== 'icons' && (
        <span className={styles.texts}>
          <bdi className={styles.name}>{name}</bdi>
          {view === 'cards' && (
            <>
              <span className={styles.description}>{appTexts.description(app)}</span>
              {/* Pushed to the bottom, so it lines up across the cards of a row. */}
              <span className={ready ? styles.open : styles.badge}>
                {t(ready ? 'common.action.open' : 'shell.app.comingSoon')}
              </span>
            </>
          )}
        </span>
      )}
    </>
  );

  // Without its text, an item says what it is in a tooltip.
  const label = ready ? name : t('shell.app.comingSoonNamed', { name });
  const hint = view === 'cards' ? {} : { 'aria-label': label, ...tooltip(label) };

  return ready ? (
    <button type="button" className={styles.item} {...appInk(app)} {...hint} onClick={() => tabs.openApp(app.manifest.id)}>
      {body}
    </button>
  ) : (
    // Focusable although it opens nothing: it can still be moved with Alt + arrows.
    <div className={styles.item} data-pending="true" tabIndex={0} {...appInk(app)} {...hint}>
      {body}
    </div>
  );
}

interface DropPlace {
  readonly index: number;
  readonly before: boolean;
}

/**
 * The apps on the start screen, read from `apps/<app-id>/app.json`. The user
 * chooses which ones show, how they are drawn and, by dragging, in what
 * order; the app bar follows the same choice and order.
 */
export function AppGrid() {
  const { t, direction } = useI18n();
  const { status, apps } = useApps();
  const appTexts = useAppTexts();
  const { appsView, appOrder, hiddenApps, shownComingApps } = useStore(preferences);
  const changed = appsView !== 'cards' || appOrder.length > 0 || hiddenApps.length > 0 || shownComingApps.length > 0;
  const headingId = useId();
  const [dragged, setDragged] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropPlace | null>(null);
  const ids = apps.map((app) => app.manifest.id);

  // An app still to come shows only when the user chose to see it; the others unless the user took them off.
  const isShown = (app: (typeof apps)[number]) => (app.manifest.status === 'active' ? !hiddenApps.includes(app.manifest.id) : shownComingApps.includes(app.manifest.id));
  const shownApps = apps.filter(isShown);

  /** Moves an app just before the one now at `before` among the apps that show. */
  const moveTo = (id: string, before: number) => {
    const next = shownApps[Math.max(before, 0)];
    updatePreferences({ appOrder: moveApp(ids, id, next ? ids.indexOf(next.manifest.id) : ids.length) });
  };

  const toggleShown = (id: string) => {
    const coming = apps.find((app) => app.manifest.id === id)?.manifest.status !== 'active';
    if (coming) updatePreferences({ shownComingApps: shownComingApps.includes(id) ? shownComingApps.filter((shown) => shown !== id) : [...shownComingApps, id] });
    else updatePreferences({ hiddenApps: hiddenApps.includes(id) ? hiddenApps.filter((hidden) => hidden !== id) : [...hiddenApps, id] });
  };

  const onDragOver = (index: number, event: DragEvent) => {
    if (dragged === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const box = event.currentTarget.getBoundingClientRect();
    const firstHalf = event.clientX < box.left + box.width / 2;
    // "Before" is the left half when reading left to right, the right half otherwise.
    const before = direction === 'rtl' ? !firstHalf : firstHalf;
    setDrop((current) => (current?.index === index && current.before === before ? current : { index, before }));
  };

  const endDrag = () => {
    setDragged(null);
    setDrop(null);
  };

  // Alt + arrow moves the app that has the keyboard focus, for those who do not drag.
  const onKeyDown = (index: number, id: string, event: KeyboardEvent) => {
    if (!event.altKey) return;
    const forward = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const backward = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    if (event.key === forward) moveTo(id, index + 2);
    else if (event.key === backward) moveTo(id, index - 1);
    else return;
    event.preventDefault();
  };

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <div className={styles.head}>
        <h2 id={headingId} className={styles.heading}>
          {t('shell.start.apps')}
        </h2>
        {changed && (
          <button
            type="button"
            className={styles.reset}
            {...tooltip(t('shell.start.resetHint'), 'bottom-end')}
            onClick={() => updatePreferences({ appsView: 'cards', appOrder: [], hiddenApps: [], shownComingApps: [] })}
          >
            <Icon name="arrow-rotate-left" size={13} />
            {t('shell.start.reset')}
          </button>
        )}
        <MenuButton
          variant="text"
          icon="eye"
          closeOnLeave
          label={t('shell.start.shown')}
          sections={[
            {
              id: 'apps',
              title: t('shell.start.shownTitle'),
              items: apps.map((app) => ({
                id: app.manifest.id,
                label: appTexts.name(app),
                kind: 'toggle' as const,
                checked: isShown(app),
                onSelect: () => toggleShown(app.manifest.id),
              })),
            },
          ]}
        />
        <div role="radiogroup" aria-label={t('shell.start.viewLabel')} className={styles.views}>
          {APPS_VIEWS.map((view) => (
            <button
              key={view}
              type="button"
              role="radio"
              aria-checked={appsView === view}
              aria-label={t(VIEW_OPTIONS[view].labelKey)}
              className={styles.viewButton}
              {...tooltip(t(VIEW_OPTIONS[view].labelKey), 'bottom-end')}
              onClick={() => updatePreferences({ appsView: view })}
            >
              <Icon name={VIEW_OPTIONS[view].icon} size={16} />
            </button>
          ))}
        </div>
      </div>

      {status === 'error' && <p role="alert">{t('shell.app.loadError')}</p>}
      <ul className={styles.grid} data-view={appsView}>
        {shownApps.map((app, index) => {
          const { id } = app.manifest;
          return (
            <li
              key={id}
              className={styles.place}
              draggable
              data-dragged={dragged === id}
              data-drop={drop?.index === index ? (drop.before ? 'before' : 'after') : undefined}
              onDragStart={(event) => {
                setDragged(id);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', id);
              }}
              onDragOver={(event) => onDragOver(index, event)}
              onDrop={(event) => {
                event.preventDefault();
                if (dragged !== null && drop) moveTo(dragged, drop.before ? drop.index : drop.index + 1);
                endDrag();
              }}
              onDragEnd={endDrag}
              onKeyDown={(event) => onKeyDown(index, id, event)}
            >
              <AppItem app={app} view={appsView} />
            </li>
          );
        })}
        {status === 'ready' && appsView === 'cards' && <li className={styles.more}>{t('shell.app.moreLater')}</li>}
      </ul>
      <p className={styles.tip}>{t('shell.start.reorderTip')}</p>
    </section>
  );
}
