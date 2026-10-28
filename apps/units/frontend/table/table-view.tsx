import { useI18n } from '@syntelab/i18n';
import { AppInvokeError } from '@syntelab/shell-api';
import { DataGrid, kept, NOTHING_SELECTED, selectedColumns, selectedCount, selectedRowRuns } from '@syntelab/data-grid';
import type { GridColumn, Selection } from '@syntelab/data-grid';
import type { AppHost } from '@syntelab/shell-api';
import { Button, Dialog } from '@syntelab/ui-kit';
import { useEffect, useMemo, useState } from 'react';
import { unitName } from '../engine/names';
import { loadConverter } from '../engine/units-api';
import type { ConverterInfo } from '../engine/units-api';
import { copiedNumber, localNumber, marksOf } from '../format/local-number';
import { OwnUnitDialog } from '../own/own-unit-dialog';
import { ownUnitsOf, saveOwnUnits, useOwnUnitsVersion } from '../own/own-units';
import type { OwnUnit } from '../own/own-units';
import { UnitsPanel, UnitsRail } from '../panel/units-panel';
import { RatesLine } from '../rates/rates-line';
import { CURRENCY, useRates } from '../rates/rates-store';
import { pinsOf, savePins } from '../pins/pins-store';
import { changeSettings, DEFAULT_SETTINGS, loadSettings, useUnitsSettings } from '../settings/units-settings';
import { ColumnMenu } from './column-menu';
import { columnsOf, drawnOrder, moved, pinned, saveColumns, startingUnits, toggled, widthOf, withNumbersWidth, withPrecision, withWidth } from './columns';
import type { Columns } from './columns';
import { clearRows, closeTable, copyTable, exportTable, importFile, longestCells, openTable, pasteClipboard, redoTable, resizeTable, setCell, undoTable } from './table-api';
import { TableBar } from './table-bar';
import type { FileFormat, Pasted, TableFacts, TableIn, TableOut } from './table-api';
import type { ExportKind, ImportKind } from './table-bar';
import styles from './table-view.module.css';
import { useRows } from './use-rows';
import { WorkProgress } from './work-progress';
import type { WorkKind } from './work-progress';

export interface TableViewProps {
  readonly host: Pick<AppHost, 'invoke' | 'loadData' | 'saveData' | 'pickFiles' | 'pickSavePath' | 'openLink' | 'active' | 'openSettings'>;
  readonly converterId: string;
  /** The name the table is kept under on the Rust side: one for each tab and converter. */
  readonly table: string;
  /** Hears whether the table has values: asked before it is left. */
  readonly onFilled: (filled: number) => void;
}

/** The tables that are on screen, by their names; and how long after one leaves it that it is forgotten. */
const shownTables = new Set<string>();
const FORGOTTEN_AFTER = 1000;

/** What the line under the table says was done last: a key of the translations, with its values. */
type LastAction = { readonly key: string; readonly values?: Readonly<Record<string, string | number>>; readonly problem?: boolean };

/**
 * The table of one converter: the bar over it, the grid, the units panel
 * beside it and the line under it. The values are kept on the Rust side;
 * here are the columns, what is selected, and what is in sight.
 */
export function TableView({ host, converterId, table, onFilled }: TableViewProps) {
  const { t, language } = useI18n();
  const settings = useUnitsSettings(host);
  const [converter, setConverter] = useState<ConverterInfo | null>(null);
  const [facts, setFacts] = useState<TableFacts | null>(null);
  const [columns, setColumns] = useState<Columns | null>(null);
  const [pins, setPins] = useState<readonly string[]>([]);
  const [selection, setSelection] = useState<Selection>(NOTHING_SELECTED);
  /** Goes up whenever a value of the table changes: the rows in sight are read again. */
  const [version, setVersion] = useState(0);
  const [last, setLast] = useState<LastAction>({ key: 'units.table.ready' });
  /** The unit of the user's own being made (`new`) or changed (its id); null while the window for it is closed. */
  const [ownDialog, setOwnDialog] = useState<string | null>(null);
  const ownVersion = useOwnUnitsVersion();
  /** The long work the table is doing: a card over it says how far it has got. */
  const [work, setWork] = useState<WorkKind | null>(null);
  /** A change of very many rows that there is no memory to undo: asked whether to make it without. */
  const [undoAsked, setUndoAsked] = useState<{ readonly size: string; readonly again: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setConverter(null);
    setFacts(null);
    setColumns(null);
    setSelection(NOTHING_SELECTED);
    setLast({ key: 'units.table.ready' });
    void Promise.all([loadConverter(host, converterId), openTable(host, table, converterId)]).then(
      ([loaded, opened]) => {
        if (cancelled) return;
        setConverter(loaded);
        setColumns(columnsOf(host, loaded, loadSettings(host).startsWith[loaded.id]));
        setPins(pinsOf(host, loaded));
        setFacts(opened);
        setVersion((count) => count + 1);
      },
      () => !cancelled && setLast({ key: 'units.table.failed', problem: true }),
    );
    return () => {
      cancelled = true;
    };
  }, [converterId, table, host.invoke]);

  // The user's own units changed (here, in another tab, in Settings): the converter is read again, and the table goes on.
  // Columns of units that are gone go with them.
  useEffect(() => {
    if (!converter || converter.id !== converterId) return;
    let cancelled = false;
    void loadConverter(host, converterId).then(
      (loaded) => {
        if (cancelled || loaded === converter) return;
        setConverter(loaded);
        setColumns((before) => {
          if (!before) return before;
          const known = (id: string) => loaded.units.some((unit) => unit.id === id);
          return { ...before, order: before.order.filter(known), pinnedStart: before.pinnedStart.filter(known), pinnedEnd: before.pinnedEnd.filter(known) };
        });
        setPins((before) => before.filter((id) => loaded.units.some((unit) => unit.id === id)));
        // The Rust side kept the rows; what they show may have changed.
        void openTable(host, table, converterId).then((opened) => {
          if (cancelled) return;
          setFacts(opened);
          setVersion((count) => count + 1);
        });
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [ownVersion]);

  // The table is forgotten on the Rust side when its tab goes, or goes to another converter: a moment later, and
  // only if nothing shows it again by then (a tab that is drawn twice while it starts must not lose its table).
  useEffect(() => {
    shownTables.add(table);
    return () => {
      shownTables.delete(table);
      setTimeout(() => !shownTables.has(table) && void closeTable(host, table).catch(() => {}), FORGOTTEN_AFTER);
    };
  }, [table, host.invoke]);

  useEffect(() => {
    onFilled(facts?.filled ?? 0);
  }, [facts?.filled]);

  const drawn = useMemo(() => (columns ? drawnOrder(columns) : []), [columns]);
  // The decimals asked for: those the user chose for a unit, and over them those of a column.
  const chosenDecimals = settings.precision[converterId];
  const writing = useMemo(() => ({ units: drawn, decimals: { ...chosenDecimals, ...columns?.precision }, extremes: settings.extremes }), [drawn, columns?.precision, chosenDecimals, settings.extremes]);
  // New rates of currencies change what the rows come to, as a typed value does.
  const rates = useRates();
  // While the table does something long, the Rust side holds it: nothing is asked of it till it is done.
  const rows = useRows(host, facts && work === null ? table : null, writing, version + (converterId === CURRENCY ? rates.version * 1_000_000 : 0));

  const change = (next: Columns) => {
    setColumns(next);
    saveColumns(host, converterId, next);
  };

  const gridColumns = useMemo((): GridColumn[] => {
    if (!converter || !columns) return [];
    return drawn.flatMap((id) => {
      const unit = converter.units.find((known) => known.id === id);
      if (!unit) return [];
      // What the head says: the name and the symbol, or one of the two, as the options of the bar ask.
      const title = settings.headFormat === 'symbol' ? '' : unitName(t, converter.id, unit);
      const symbol = settings.headFormat === 'name' ? '' : unit.symbol;
      return [{ id, title, symbol, text: unit.text === true, fromStart: true, color: converter.groups.find((group) => group.id === unit.group)?.color, width: widthOf(columns, id), held: columns.pinnedStart.includes(id) ? 'start' : columns.pinnedEnd.includes(id) ? 'end' : null }];
    });
  }, [converter, columns, drawn, settings.headFormat, t]);

  if (!converter || !columns || !facts) {
    return (
      <div className={styles.view}>
        <p className={styles.waiting} role={last.problem ? 'alert' : 'status'}>
          {t(last.problem ? last.key : 'units.table.opening')}
        </p>
      </div>
    );
  }

  /** The units whose values are text (base 16, Roman numerals): shown and edited as they are. */
  const textUnits = new Set(converter.units.filter((unit) => unit.text).map((unit) => unit.id));
  const bounds = { rows: facts.rows, cols: gridColumns.length };
  const shownSelection = kept(selection, bounds);

  const changed = (next: TableFacts, action: LastAction) => {
    setFacts(next);
    setVersion((count) => count + 1);
    setLast(action);
  };

  /** Runs of rows cut to those the table has: the empty rows below it hold nothing to copy or empty. */
  const inTable = (runs: [number, number][]): [number, number][] =>
    runs.filter(([from]) => from < facts.rows).map(([from, to]): [number, number] => [from, Math.min(to, facts.rows - 1)]);

  const commit = async (row: number, unit: string, text: string): Promise<boolean> => {
    try {
      const answer = await setCell(host, table, row, unit, text, marksOf(language).decimal);
      // What is not a number is kept and shown in red: said, but not refused.
      if (answer.wrong) changed(answer.facts, { key: 'units.table.notANumber', values: { row: row + 1 }, problem: true });
      else changed(answer.facts, answer.ambiguous ? { key: 'units.table.ambiguous', values: { mark: marksOf(language).decimal } } : { key: text.trim() === '' ? 'units.table.cleared' : 'units.table.typed', values: { row: row + 1 } });
      return true;
    } catch (error) {
      failed(error);
      return false;
    }
  };

  /** So many bytes, as a person reads them. */
  const sizeOf = (bytes: number) => {
    const [value, unit] = bytes >= 1024 ** 3 ? [bytes / 1024 ** 3, 'GB'] : [bytes / 1024 ** 2, 'MB'];
    return `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(Math.max(value, 0.1))} ${unit}`;
  };
  const codeOf = (error: unknown) => (error instanceof AppInvokeError ? error.code : null);
  /** The bytes the Rust side says it could not have: the detail of its refusal. */
  const sizeIn = (error: unknown) => sizeOf(error instanceof Error ? Number(error.message) || 0 : 0);
  const failed = (error: unknown, usual = 'units.table.failed') => {
    const code = codeOf(error);
    if (code === 'stopped') return setLast({ key: 'units.table.stoppedOut' });
    if (code === 'no-memory' || code === 'no-memory-to-undo') return setLast({ key: 'units.table.noMemory', values: { size: sizeIn(error) }, problem: true });
    setLast({ key: code === 'too-large' ? 'units.table.tooLarge' : code === 'no-clipboard' ? 'units.table.clipboardRefused' : code === 'not-read' ? 'units.table.notRead' : code === 'not-written' ? 'units.table.notWritten' : usual, problem: true });
  };

  /** Does something long: the card over the table says how far it has got, and can stop it. */
  const long = async <T,>(kind: WorkKind, run: () => Promise<T>): Promise<T> => {
    setWork(kind);
    try {
      return await run();
    } finally {
      setWork(null);
    }
  };

  /**
   * Makes a change that may be of very many rows. Where the computer has no memory to keep the table as it was,
   * the user is asked whether to make the change without a way back; nothing is changed till they answer.
   */
  const undoably = (run: (noUndo: boolean) => Promise<void>) => {
    const attempt = (noUndo: boolean): Promise<void> =>
      run(noUndo).catch((error: unknown) => {
        if (!noUndo && codeOf(error) === 'no-memory-to-undo') setUndoAsked({ size: sizeIn(error), again: () => void attempt(true) });
        else failed(error);
      });
    void attempt(false);
  };

  const clear = (what: { readonly runs?: [number, number][]; readonly all?: boolean }, action: LastAction) => {
    undoably((noUndo) => clearRows(host, table, { ...what, noUndo }).then((next) => changed(next, action)));
  };

  const grow = () => {
    void resizeTable(host, table, facts.rows + 1).then((next) => setFacts(next), failed);
  };

  const togglePin = (unit: string) => {
    const next = pins.includes(unit) ? pins.filter((known) => known !== unit) : [...pins, unit];
    setPins(next);
    savePins(host, converterId, next);
  };

  const own = ownUnitsOf(host, converterId);
  /** Keeps the user's own units of this converter; a new one becomes a column at once. */
  const keepOwn = (units: readonly OwnUnit[]) => {
    const added = units.filter((unit) => !own.some((before) => before.id === unit.id)).map((unit) => unit.id);
    saveOwnUnits(host, converterId, units);
    if (added.length > 0) change({ ...columns, order: [...columns.order, ...added] });
    setOwnDialog(null);
    setLast({ key: 'units.own.kept' });
  };
  const removeOwn = (id: string) => {
    // Units said by the one that goes would be left without a meaning: they go with it.
    const gone = new Set([id]);
    for (const unit of own) if (gone.has(unit.reference)) gone.add(unit.id);
    saveOwnUnits(host, converterId, own.filter((unit) => !gone.has(unit.id)));
    setLast({ key: 'units.own.removed', values: { count: gone.size } });
  };

  const unitDecimals = (id: string) => chosenDecimals?.[id] ?? converter.units.find((unit) => unit.id === id)?.decimals ?? 2;
  const selected = selectedCount(shownSelection);
  const history = (back: boolean) => {
    void (back ? undoTable : redoTable)(host, table).then(
      (answer) => answer.done && changed(answer.facts, { key: back ? 'units.table.undone' : 'units.table.redone' }),
      failed,
    );
  };

  /** What a column is titled with, as its head says it. */
  const titleOf = (id: string) => {
    const column = gridColumns.find((known) => known.id === id);
    return !column ? id : column.title !== '' && column.symbol !== '' ? `${column.title} (${column.symbol})` : column.title || column.symbol;
  };
  /** What is written of the table when it is copied or exported: all of it, or what is selected. */
  const out = (what: 'all' | 'selected', transposed: boolean): TableOut => {
    const units = what === 'all' ? drawn : selectedColumns(shownSelection).flatMap((col) => gridColumns[col]?.id ?? []);
    return {
      ...writing,
      units,
      titles: settings.withTitles ? units.map(titleOf) : undefined,
      rowNumbers: settings.withRowNumbers,
      transposed,
      runs: what === 'all' ? undefined : inTable(selectedRowRuns(shownSelection)),
      decimalMark: marksOf(language).decimal,
    };
  };

  const copy = (what: 'all' | 'selected', transposed: boolean) => {
    void long('copying', () => copyTable(host, table, out(what, transposed), 'tsv')).then((answer) => setLast({ key: 'units.table.copied', values: { count: answer.rows } }), failed);
  };

  /** Every way a column may be titled, and the unit that is: what tells the columns of pasted text apart. */
  const into = (transposed: boolean, from = 0): TableIn => {
    const names: Record<string, string> = {};
    for (const unit of converter.units) {
      const name = unitName(t, converter.id, unit);
      for (const title of [name, `${name} (${unit.symbol})`, unit.symbol, unit.id]) names[title] ??= unit.id;
    }
    return { columns: drawn.slice(from), names, transposed, decimalMark: marksOf(language).decimal };
  };

  /** After a paste or an import: the units its titles named become columns, and the line under the table says what came. */
  const arrived = (answer: Pasted, key: string, replace: boolean) => {
    // Stopped halfway: the table is as it was. Changed without a way back, it keeps the rows that came before the stop.
    if (answer.stopped && answer.rows === 0) return changed(answer.facts, { key: 'units.table.stopped' });
    const missing = answer.units.filter((unit) => !columns.order.includes(unit));
    if (answer.titled && replace) change({ ...columns, order: [...new Set(answer.units)], pinnedStart: [], pinnedEnd: [] });
    else if (missing.length > 0) change({ ...columns, order: [...columns.order, ...missing] });
    changed(answer.facts, answer.rows === 0 ? { key: 'units.table.nothingPasted', problem: true } : answer.stopped ? { key: 'units.table.stoppedKept', values: { count: answer.rows }, problem: true } : { key, values: { count: answer.rows, wrong: answer.wrong, leftOut: answer.leftOut }, problem: answer.wrong > 0 });
  };

  // What was copied is read on the Rust side, straight from the clipboard: it may be millions of rows, more than
  // the interface could hand over.
  const pasteFromClipboard = (transposed: boolean) => {
    setLast({ key: 'units.table.pasting' });
    const [row, where] = [shownSelection.active.row, into(transposed, shownSelection.active.col)];
    undoably((noUndo) => long('pasting', () => pasteClipboard(host, table, row, where, noUndo)).then((answer) => arrived(answer, 'units.table.pasted', false)));
  };

  const EXTENSIONS: Readonly<Record<ImportKind, readonly string[]>> = { excel: ['xlsx', 'xlsm', 'xls', 'ods'], csv: ['csv'], tsv: ['tsv', 'txt'], auto: ['xlsx', 'xlsm', 'xls', 'ods', 'csv', 'tsv', 'txt'] };
  const importFrom = async (kind: ImportKind, transposed: boolean) => {
    const [path] = await host.pickFiles({ typeName: t(`units.bar.files.${kind}`), extensions: EXTENSIONS[kind] });
    if (path === undefined) return;
    setLast({ key: 'units.table.importing' });
    undoably((noUndo) => long('importing', () => importFile(host, table, path, kind, into(transposed), noUndo)).then((answer) => arrived(answer, 'units.table.imported', true)));
  };

  const exportTo = async (kind: ExportKind, transposed: boolean) => {
    const extension = kind === 'excel' ? 'xlsx' : kind;
    const path = await host.pickSavePath({ typeName: t(`units.bar.files.${kind}`), extension, suggestedName: `${t(`units.converter.${converter.id}`)}${transposed ? ` (${t('units.bar.transposed').toLowerCase()})` : ''}.${extension}` });
    if (path === null) return;
    setLast({ key: 'units.table.exporting' });
    await long('exporting', () => exportTable(host, table, out('all', transposed), kind as FileFormat, path)).then((answer) => setLast({ key: 'units.table.exported', values: { count: answer.rows } }), failed);
  };

  return (
    <div className={styles.view} data-table={table}>
      <div className={styles.main}>
        {/* The bar of the table: always over its head, whatever the layout of the program. */}
        <TableBar
          canFit={Object.keys(columns.widths).length > 0 || columns.numbersWidth !== undefined}
          onFit={() => {
            // Every width that was dragged or fitted goes: the columns share the room of the table again.
            change({ ...columns, widths: {}, numbersWidth: undefined });
            setLast({ key: 'units.table.fitted' });
          }}
          onSettings={() => host.openSettings()}
          canUndo={facts.canUndo}
          canRedo={facts.canRedo}
          hasSelection={selected > 0}
          hasValues={facts.filled > 0}
          headFormat={settings.headFormat}
          withTitles={settings.withTitles}
          withRowNumbers={settings.withRowNumbers}
          onUndo={() => history(true)}
          onRedo={() => history(false)}
          onCopy={copy}
          onPaste={pasteFromClipboard}
          onImport={(kind, transposed) => void importFrom(kind, transposed).catch(failed)}
          onExport={(kind, transposed) => void exportTo(kind, transposed).catch(failed)}
          onClearSelected={() => clear({ runs: inTable(selectedRowRuns(shownSelection)) }, { key: 'units.table.clearedSelection' })}
          onClearAll={() => clear({ all: true }, { key: 'units.table.clearedAll' })}
          onHeadFormat={(headFormat) => changeSettings(host, { headFormat })}
          onWithTitles={() => changeSettings(host, { withTitles: !settings.withTitles })}
          onWithRowNumbers={() => changeSettings(host, { withRowNumbers: !settings.withRowNumbers })}
          onStartWith={() => {
            changeSettings(host, { startsWith: { ...settings.startsWith, [converter.id]: drawn } });
            setLast({ key: 'units.table.startsWith' });
          }}
          onReset={() => {
            // The table as the converter ships it: its first columns, shared equally, and nothing in it.
            change({ order: startingUnits(converter, settings.startsWith[converter.id]), widths: {}, pinnedStart: [], pinnedEnd: [], precision: {} });
            clear({ all: true }, { key: 'units.table.reset' });
          }}
        />

        {gridColumns.length === 0 ? (
          <p className={styles.waiting}>{t('units.table.noColumns')}</p>
        ) : (
          <DataGrid
            columns={gridColumns}
            rowCount={facts.rows}
            endless
            rowNumbers={settings.rowNumbers}
            stamp={rows.stamp}
            need={rows.need}
            cell={(row, column) => {
              // Below the table: an empty row, until something is typed in it.
              if (row >= facts.rows) return { shown: '', edited: '', typed: false };
              const read = rows.cellAt(row, column);
              if (!read) return undefined;
              // What is not a number is shown, and edited, as it was typed.
              if (read.wrong || textUnits.has(column)) return { shown: read.text, edited: read.text, typed: read.typed, wrong: read.wrong };
              return { shown: read.text === '' ? '' : localNumber(read.text, language, settings.between), edited: read.text === '' ? '' : copiedNumber(read.text, language), typed: read.typed };
            }}
            selection={shownSelection}
            onSelection={setSelection}
            onCommit={commit}
            onClear={(runs) => clear({ runs: inTable(runs) }, { key: 'units.table.clearedSelection' })}
            onGrow={grow}
            onColumnWidth={(id, width) => change(withWidth(columns, id, width))}
            numbersWidth={columns.numbersWidth ?? null}
            onNumbersWidth={(width) => change(withNumbersWidth(columns, width))}
            longest={async (id) => {
              const [text = ''] = await longestCells(host, table, { ...writing, units: [id] });
              return textUnits.has(id) ? text : localNumber(text, language, settings.between);
            }}
            onShortcut={(what) => {
              if (what === 'undo') return history(true);
              if (what === 'redo') return history(false);
              copy('selected', false);
              // Cut: what was copied is emptied.
              if (what === 'cut') clear({ runs: inTable(selectedRowRuns(shownSelection)) }, { key: 'units.table.clearedSelection' });
            }}
            onPaste={() => pasteFromClipboard(false)}
            columnMenu={(id, close) => {
              const held = columns.pinnedStart.includes(id) ? 'start' : columns.pinnedEnd.includes(id) ? 'end' : null;
              return (
                <ColumnMenu
                  decimals={columns.precision[id] ?? unitDecimals(id)}
                  unitDecimals={unitDecimals(id)}
                  held={held}
                  canMoveStart={moved(columns, id, -1) !== columns}
                  canMoveEnd={moved(columns, id, 1) !== columns}
                  onMove={(by) => change(moved(columns, id, by))}
                  onDecimals={(decimals) => {
                    change(withPrecision(columns, id, decimals));
                    setLast({ key: 'units.table.precisionChanged', values: { unit: unitName(t, converter.id, converter.units.find((unit) => unit.id === id) ?? { id }) } });
                  }}
                  onEverywhere={
                    textUnits.has(id)
                      ? undefined
                      : () => {
                          // The unit takes the precision of the column, which then has none of its own.
                          changeSettings(host, { precision: { ...settings.precision, [converter.id]: { ...chosenDecimals, [id]: columns.precision[id] ?? unitDecimals(id) } } });
                          change(withPrecision(columns, id, null));
                          setLast({ key: 'units.table.precisionEverywhere' });
                        }
                  }
                  onHold={(edge) => change(pinned(columns, id, edge))}
                  onRemove={() => change(toggled(columns, id))}
                  onClose={close}
                />
              );
            }}
            labels={{ table: t('units.table.title', { converter: t(`units.converter.${converter.id}`) }), selectAll: t('units.table.selectAll'), columnMenu: t('units.column.menu'), resize: t('units.column.resize'), row: (row) => t('units.table.rowNumber', { row }) }}
          />
        )}

        {work !== null && <WorkProgress host={host} kind={work} />}
        {converterId === CURRENCY && <RatesLine host={host} />}
        <div className={styles.status} role="status">
          <span>{t('units.status.rows', { count: facts.rows })}</span>
          <span>{t('units.status.filled', { count: facts.filled })}</span>
          <span>{t('units.status.columns', { count: gridColumns.length })}</span>
          <span>{t('units.status.selected', { count: selected })}</span>
          {facts.wrong > 0 && <span className={styles.wrong}>{t('units.status.wrong', { count: facts.wrong })}</span>}
          <span className={styles.spring} />
          <span className={styles.last} data-problem={last.problem === true}>
            {t(last.key, last.values)}
          </span>
        </div>
      </div>

      {settings.panelShown ? (
        <UnitsPanel converter={converter} shown={drawn} pins={pins} width={settings.panelWidth} onToggle={(unit) => change(toggled(columns, unit))} onPin={togglePin} onCollapse={() => changeSettings(host, { panelShown: false })} activeFolded={settings.activeFolded} addingFolded={settings.addingFolded} onFold={(folded) => changeSettings(host, folded)} onWidth={(width) => changeSettings(host, { panelWidth: width ?? DEFAULT_SETTINGS.panelWidth })} onNewUnit={() => setOwnDialog('new')} onChangeUnit={setOwnDialog} onRemoveUnit={removeOwn} />
      ) : (
        <UnitsRail onShow={() => changeSettings(host, { panelShown: true })} />
      )}
      <Dialog open={undoAsked !== null} onClose={() => setUndoAsked(null)} title={t('units.undo.title')} closeLabel={t('common.action.close')}>
        <div className={styles.asked}>
          <p>{t('units.undo.lead', { size: undoAsked?.size ?? '' })}</p>
          <p>{t('units.undo.note')}</p>
          <div className={styles.askedActions}>
            <Button onClick={() => setUndoAsked(null)}>{t('common.action.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                undoAsked?.again();
                setUndoAsked(null);
              }}
            >
              {t('units.undo.continue')}
            </Button>
          </div>
        </div>
      </Dialog>
      <OwnUnitDialog host={host} thousands={settings.between} converter={converter} all={own} editing={own.find((unit) => unit.id === ownDialog) ?? null} open={ownDialog !== null} onClose={() => setOwnDialog(null)} onSave={keepOwn} />
    </div>
  );
}
