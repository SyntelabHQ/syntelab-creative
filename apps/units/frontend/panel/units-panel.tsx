import { useTranslation } from '@syntelab/i18n';
import { Icon } from '@syntelab/ui-kit';
import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { ConverterInfo, UnitInfo } from '../engine/units-api';
import { groupName, OWN_GROUP, unitName } from '../engine/names';
import { plain } from '../search/plain';
import styles from './units-panel.module.css';

export interface UnitsPanelProps {
  readonly converter: ConverterInfo;
  /** The units that are columns of the table, in the order they are drawn. */
  readonly shown: readonly string[];
  /** The user's favourites. */
  readonly pins: readonly string[];
  readonly width: number;
  /** Adds a unit as a column, or takes its column out. */
  readonly onToggle: (unit: string) => void;
  readonly onPin: (unit: string) => void;
  readonly onCollapse: () => void;
  /** The units of the table are folded away; so are the search and the filters: the list has the room. */
  readonly activeFolded: boolean;
  readonly addingFolded: boolean;
  readonly onFold: (folded: { readonly activeFolded?: boolean; readonly addingFolded?: boolean }) => void;
  /** The edge of the panel was dragged to this width; null puts it back as it ships. */
  readonly onWidth: (width: number | null) => void;
  /** Makes a unit of the user's own; changes one; takes one out. */
  readonly onNewUnit: () => void;
  readonly onChangeUnit: (unit: string) => void;
  readonly onRemoveUnit: (unit: string) => void;
}

/**
 * The units of the converter, beside its table. First those in use: one chip
 * for each column, a click takes it out. Under them, every unit: looked for
 * by name, filtered by group, the pinned and the popular ones first. A click
 * adds a unit as a column or takes it out; its bookmark makes it a favourite.
 */
export function UnitsPanel({ converter, shown, pins, width, onToggle, onPin, onCollapse, activeFolded, addingFolded, onFold, onWidth, onNewUnit, onChangeUnit, onRemoveUnit }: UnitsPanelProps) {
  const t = useTranslation();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [popularOnly, setPopularOnly] = useState(false);

  // Shown in the colour of the program for as long as it is held, as the line between the panes of Dev.
  const [dragging, setDragging] = useState(false);
  // Dragging the edge towards the table widens the panel: to the left where it stands on the right, and the other way about.
  const dragged = useRef<{ readonly from: number; readonly width: number; readonly towards: 1 | -1 } | null>(null);
  const dragStart = (event: PointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    const rightToLeft = getComputedStyle(event.currentTarget).direction === 'rtl';
    dragged.current = { from: event.clientX, width, towards: rightToLeft ? 1 : -1 };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const dragMove = (event: PointerEvent<HTMLSpanElement>) => {
    const from = dragged.current;
    if (from) onWidth(from.width + (event.clientX - from.from) * from.towards);
  };
  const dragEnd = (event: PointerEvent<HTMLSpanElement>) => {
    dragged.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  // With the keys: the arrow towards the table widens the panel.
  const onEdgeKey = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const rightToLeft = getComputedStyle(event.currentTarget).direction === 'rtl';
    const towardsTable = event.key === (rightToLeft ? 'ArrowRight' : 'ArrowLeft');
    onWidth(width + (towardsTable ? 20 : -20));
  };

  const nameOf = (unit: UnitInfo) => unitName(t, converter.id, unit);
  const colorOf = (unit: UnitInfo) => converter.groups.find((known) => known.id === unit.group)?.color;
  const wanted = plain(query.trim());
  const listed = converter.units.filter(
    (unit) => (group === null || unit.group === group) && (!popularOnly || unit.popular || pins.includes(unit.id)) && (wanted === '' || [nameOf(unit), unit.symbol, unit.id, ...unit.aliases].some((name) => plain(name).includes(wanted))),
  );
  // Favourites first, then the popular ones, then as the converter lists them.
  const rank = (unit: UnitInfo) => (pins.includes(unit.id) ? 0 : unit.popular ? 1 : 2);
  const ordered = [...listed].sort((one, other) => rank(one) - rank(other));

  return (
    <aside className={styles.panel} style={{ width }} aria-label={t('units.panel.title')}>
      <span className={styles.edge} role="separator" tabIndex={0} aria-orientation="vertical" aria-label={t('units.panel.resize')} data-dragging={dragging} onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd} onDoubleClick={() => onWidth(null)} onKeyDown={onEdgeKey} />
      <div className={styles.top}>
        <button type="button" className={styles.part} aria-expanded={!activeFolded} onClick={() => onFold({ activeFolded: !activeFolded })}>
          <Icon name={activeFolded ? 'chevron-right' : 'chevron-down'} size={10} />
          <span>{t('units.panel.shown', { count: shown.length, all: converter.units.length })}</span>
        </button>
        <button type="button" className={styles.fold} aria-label={t('units.panel.fold')} data-tooltip={t('units.panel.fold')} onClick={onCollapse}>
          <Icon name="chevron-right" size={11} />
        </button>
      </div>
      {!activeFolded && (
        <div className={styles.active} role="group" aria-label={t('units.panel.shown', { count: shown.length, all: converter.units.length })}>
          {shown.length === 0 && <p className={styles.said}>{t('units.active.none')}</p>}
          {shown.flatMap((id) => {
            const unit = converter.units.find((known) => known.id === id);
            if (!unit) return [];
            return [
              <button key={id} type="button" className={styles.chip} data-tooltip={t('units.active.remove')} aria-label={t('units.active.removeNamed', { unit: nameOf(unit) })} onClick={() => onToggle(id)}>
                <span className={styles.chipSymbol} dir="ltr" style={{ color: colorOf(unit) }}>
                  {unit.symbol}
                </span>
                <span className={styles.chipName}>{nameOf(unit)}</span>
                <Icon name="xmark" size={10} />
              </button>,
            ];
          })}
        </div>
      )}
      <div className={styles.top}>
        <button type="button" className={styles.part} aria-expanded={!addingFolded} onClick={() => onFold({ addingFolded: !addingFolded })}>
          <Icon name={addingFolded ? 'chevron-right' : 'chevron-down'} size={10} />
          <span>{t('units.panel.adding')}</span>
        </button>
      </div>
      {!addingFolded && (
        <>
          <label className={styles.finder}>
            <Icon name="magnifying-glass" size={13} />
            <input type="search" value={query} placeholder={t('units.smart.findUnit')} aria-label={t('units.smart.findUnit')} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <div className={styles.groups}>
            <button type="button" className={styles.group} aria-pressed={group === null && !popularOnly} onClick={() => (setGroup(null), setPopularOnly(false))}>
              {t('units.smart.allGroups')}
            </button>
            <button type="button" className={styles.group} aria-pressed={popularOnly} onClick={() => setPopularOnly(!popularOnly)}>
              {t('units.panel.popular')}
            </button>
            {converter.groups.map((known) => (
              <button key={known.id} type="button" className={styles.group} aria-pressed={group === known.id} onClick={() => setGroup(group === known.id ? null : known.id)}>
                {groupName(t, converter.id, known.id)}
              </button>
            ))}
            <button type="button" className={styles.newUnit} data-tooltip={t('units.own.newHint')} onClick={onNewUnit}>
              <Icon name="file-circle-plus" size={12} />
              {t('units.own.new')}
            </button>
          </div>
        </>
      )}
      <div className={styles.list}>
        {ordered.length === 0 && <p className={styles.said}>{t('units.smart.noUnitFound')}</p>}
        {ordered.map((unit) => {
          const column = shown.includes(unit.id);
          const pinned = pins.includes(unit.id);
          return (
            <div key={unit.id} className={styles.unit} data-shown={column}>
              <button type="button" className={styles.toggle} aria-pressed={column} data-tooltip={t(column ? 'units.panel.takeOut' : 'units.panel.add')} onClick={() => onToggle(unit.id)}>
                <span className={styles.symbol} style={{ color: colorOf(unit) }} dir="ltr">
                  {unit.symbol}
                </span>
                <span className={styles.name}>{nameOf(unit)}</span>
                {column && <Icon name="check" size={12} />}
              </button>
              {unit.group === OWN_GROUP && (
                <>
                  <button type="button" className={styles.own} aria-label={t('units.own.change')} data-tooltip={t('units.own.change')} onClick={() => onChangeUnit(unit.id)}>
                    <Icon name="pen" size={11} />
                  </button>
                  <button type="button" className={styles.own} data-danger="true" aria-label={t('units.own.remove')} data-tooltip={t('units.own.remove')} onClick={() => onRemoveUnit(unit.id)}>
                    <Icon name="trash-can" size={11} />
                  </button>
                </>
              )}
              <button type="button" className={styles.pin} aria-pressed={pinned} aria-label={t(pinned ? 'units.panel.unpin' : 'units.panel.pin')} data-tooltip={t(pinned ? 'units.panel.unpin' : 'units.panel.pin')} onClick={() => onPin(unit.id)}>
                <Icon name="bookmark" size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/** The panel folded away: a strip with the way to bring it back. */
export function UnitsRail({ onShow }: { readonly onShow: () => void }) {
  const t = useTranslation();
  return (
    <div className={styles.rail}>
      <button type="button" className={styles.fold} aria-label={t('units.panel.unfold')} data-tooltip={t('units.panel.unfold')} onClick={onShow}>
        <Icon name="chevron-left" size={11} />
      </button>
    </div>
  );
}
