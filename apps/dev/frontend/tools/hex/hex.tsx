import { useI18n } from '@syntelab/i18n';
import { fileName } from '@syntelab/shell-api';
import { Icon } from '@syntelab/ui-kit';
import { useContext, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { problemKey, stopWork } from '../../api/dev-api';
import { Choice } from '../../frame/choice';
import { formatBytes, formatDuration } from '../../frame/format';
import { LaunchedFiles } from '../../frame/launched-files';
import { TextBox, Toggle } from '../../frame/toggle';
import frame from '../../frame/tool-frame.module.css';
import { ToolProgress } from '../../frame/tool-progress';
import { oneOf } from '../codec-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';
import { bytesOf, offsetOf, offsetText, readings, soughtBytes, WORDED_READINGS } from './hex-bytes';
import { HexView } from './hex-view';
import type { HexViewHandle, Picked } from './hex-view';
import styles from './hex.module.css';

const PER_ROW = ['8', '16', '24', '32'] as const;
const OFFSETS = ['hex', 'decimal'] as const;
/** Which end of a number comes first in the bytes. */
const ORDERS = ['little', 'big'] as const;
/** What is typed to be sought: bytes as hexadecimal digits, or a text (its bytes in UTF-8). */
const SOUGHT_AS = ['hex', 'text', 'utf16le', 'utf16be'] as const;
/** What the column of text shows the bytes beyond ASCII as: a dot, or the Western European letters (Windows-1252). */
const LETTERS = ['ascii', 'latin1'] as const;
/** How what is picked is written to be copied. */
const FORMS = ['hex', 'plain', 'code', 'base64', 'text'] as const;

interface Options {
  readonly perRow: (typeof PER_ROW)[number];
  readonly offsets: (typeof OFFSETS)[number];
  readonly order: (typeof ORDERS)[number];
  readonly soughtAs: (typeof SOUGHT_AS)[number];
  readonly letters: (typeof LETTERS)[number];
  readonly anyCase: boolean;
  readonly form: (typeof FORMS)[number];
}

const readOptions = (value: unknown): Options => {
  const { perRow, offsets, order, soughtAs, anyCase, form, letters } = stored(value);
  return { perRow: PER_ROW.includes(perRow as Options['perRow']) ? (perRow as Options['perRow']) : '16', offsets: oneOf(OFFSETS, offsets), order: oneOf(ORDERS, order), soughtAs: oneOf(SOUGHT_AS, soughtAs), letters: oneOf(LETTERS, letters), anyCase: anyCase === true, form: oneOf(FORMS, form) };
};

/** The bytes that are shown: of a file, read from where it is, or of a text that was pasted. */
interface Shown {
  readonly hex: number;
  readonly size: number;
  /** The name of the file; null for a text. */
  readonly name: string | null;
}

interface Told {
  readonly key: string;
  readonly values?: Readonly<Record<string, string>>;
  readonly problem?: boolean;
}

/** A search shows its card only once it has lasted this long: a quick one does not flicker. */
const CARD_AFTER = 400;

/**
 * The bytes of a file, or of a text: where each row begins, the bytes as
 * hexadecimal digits, and as letters. A file stays on disk and is read a
 * screen at a time, so one of any size opens at once. A place is gone to
 * by its number; bytes or a text are sought forward and back; what is at
 * the place picked is read as numbers of every size; what is picked is
 * copied in the forms bytes are written in, or written to a file.
 *
 * Nothing is changed in the file: this only looks.
 */
export default function Hex({ host, onActions }: ToolProps) {
  const { t, language } = useI18n();
  const [options, change] = useOptions(host, 'hex.options', readOptions);
  const [shown, setShown] = useState<Shown | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  /** The bytes at the place picked, for what they say as numbers. */
  const [at, setAt] = useState<Uint8Array | null>(null);
  // Not kept between uses: what is typed into a tool never is.
  const [goingTo, setGoingTo] = useState('');
  const [sought, setSought] = useState('');
  const [told, setTold] = useState<Told | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const view = useRef<HexViewHandle>(null);
  const sequence = useRef(0);
  const given = useContext(LaunchedFiles);

  const count = (value: number) => new Intl.NumberFormat(language).format(value);
  const perRow = Number(options.perRow);
  const low = picked ? Math.min(picked.anchor, picked.focus) : 0;
  const high = picked ? Math.max(picked.anchor, picked.focus) : -1;

  const close = (hex: number | undefined) => {
    if (hex !== undefined) void host.invoke('hex_close', { hex }).catch(() => {});
  };
  // What the Rust side holds is let go when other bytes take its place, and when the tool goes away.
  useEffect(() => () => close(shown?.hex), [shown?.hex]);

  const show = async (source: { readonly path: string } | { readonly text: string }) => {
    const mine = ++sequence.current;
    setTold(null);
    try {
      const answer = await host.invoke<{ hex: number; size: number }>('hex_open', source);
      if (mine !== sequence.current) return close(answer.hex);
      setShown({ hex: answer.hex, size: answer.size, name: 'path' in source ? fileName(source.path) : null });
      setPicked(null);
      setAt(null);
    } catch (error) {
      if (mine === sequence.current) setTold({ key: problemKey(error), problem: true });
    }
  };

  const open = async () => {
    const [path] = await host.pickFiles({ typeName: t('dev.codec.anyFile'), extensions: ['*'] });
    if (path !== undefined) await show({ path });
  };

  const paste = () =>
    void navigator.clipboard.readText().then(
      (text) => text !== '' && void show({ text }),
      () => setTold({ key: 'dev.problem.clipboard', problem: true }),
    );

  // A file the tool was opened with from outside the program.
  const taken = useRef(false);
  useEffect(() => {
    const [path] = given?.files ?? [];
    if (taken.current || path === undefined) return;
    taken.current = true;
    void show({ path });
  }, []);

  // The bytes at the place picked are read for what they say as numbers.
  const focus = picked?.focus;
  useEffect(() => {
    if (!shown || focus === undefined) return void setAt(null);
    let current = true;
    host.invoke<{ bytes: string }>('hex_rows', { hex: shown.hex, from: focus, count: 8 }).then(
      (answer) => current && setAt(bytesOf(answer.bytes)),
      () => current && setAt(null),
    );
    return () => {
      current = false;
    };
  }, [host.invoke, shown?.hex, focus]);

  const pick = (from: number, length: number) => {
    setPicked({ anchor: from, focus: from + Math.max(1, length) - 1 });
    view.current?.show(from);
  };

  const goTo = (event: FormEvent) => {
    event.preventDefault();
    if (!shown) return;
    const offset = offsetOf(goingTo);
    if (offset === null) return setTold({ key: 'dev.hex.badOffset', problem: true });
    if (offset >= shown.size) return setTold({ key: 'dev.hex.beyond', values: { last: offsetText(Math.max(0, shown.size - 1), options.offsets, shown.size) }, problem: true });
    setTold(null);
    pick(offset, 1);
  };

  /** Seeks what is typed from the place picked on, forward or back; from the other end once the end is reached. */
  const find = async (back: boolean) => {
    if (!shown || working !== null) return;
    const bytes = soughtBytes(sought, options.soughtAs);
    if (bytes === null) return setTold({ key: options.soughtAs === 'hex' ? 'dev.hex.badSought' : 'dev.hex.noSought', problem: true });
    const mine = ++sequence.current;
    setTold(null);
    const card = setTimeout(() => mine === sequence.current && setWorking(t('dev.hex.seeking')), CARD_AFTER);
    const anyCase = options.soughtAs === 'text' && options.anyCase;
    const seek = (from: number) => host.invoke<{ at: number | null; length: number; ms: number }>('hex_find', { hex: shown.hex, sought: bytes, from, back, anyCase });
    try {
      const from = picked ? (back ? low : low + 1) : back ? shown.size : 0;
      let answer = await seek(from);
      let around = false;
      // Nothing between here and the end: the search goes on from the other end, and says so.
      if (answer.at === null && (back ? from < shown.size : from > 0)) {
        answer = await seek(back ? shown.size : 0);
        around = answer.at !== null;
      }
      if (mine !== sequence.current) return;
      if (answer.at === null) return setTold({ key: 'dev.hex.notFound', problem: true });
      pick(answer.at, answer.length);
      setTold({ key: around ? 'dev.hex.foundAround' : 'dev.hex.found', values: { at: offsetText(answer.at, options.offsets, shown.size), time: formatDuration(answer.ms, language) } });
    } catch (error) {
      if (mine === sequence.current) setTold({ key: problemKey(error), problem: true });
    } finally {
      clearTimeout(card);
      if (mine === sequence.current) setWorking(null);
    }
  };

  const has = shown !== null && picked !== null;
  const copy = async () => {
    if (!shown || !picked) return;
    try {
      const answer = await host.invoke<{ text: string; count: number }>('hex_copy', { hex: shown.hex, from: low, to: high + 1, form: options.form });
      await navigator.clipboard.writeText(answer.text).then(
        () => setTold({ key: 'dev.hex.copied', values: { count: count(answer.count) } }),
        () => setTold({ key: 'dev.problem.clipboard', problem: true }),
      );
    } catch (error) {
      setTold({ key: problemKey(error), problem: true });
    }
  };

  /** What is picked, written to a file as it is. */
  const save = async () => {
    if (!shown || !picked || working !== null) return;
    const path = await host.pickSavePath({ typeName: t('dev.codec.anyFile'), extension: 'bin', suggestedName: `${shown.name ?? 'bytes'}.${offsetText(low, 'hex', shown.size)}.bin` });
    if (path === null) return;
    const mine = ++sequence.current;
    const card = setTimeout(() => mine === sequence.current && setWorking(t('dev.hex.saving')), CARD_AFTER);
    try {
      await host.invoke('hex_save', { hex: shown.hex, from: low, to: high + 1, out: path });
      if (mine === sequence.current) setTold({ key: 'dev.frame.saved', values: { path } });
    } catch (error) {
      if (mine === sequence.current) setTold({ key: problemKey(error), problem: true });
    } finally {
      clearTimeout(card);
      if (mine === sequence.current) setWorking(null);
    }
  };

  const burn = () => {
    sequence.current += 1;
    if (working !== null) void stopWork(host).catch(() => {});
    setWorking(null);
    setShown(null);
    setPicked(null);
    setAt(null);
    setGoingTo('');
    setSought('');
    setTold({ key: 'dev.frame.burnt' });
  };

  // The commands of the program reach what these do now, not what they did when they were made.
  const latest = useRef({ find, open, save, copy, burn });
  latest.current = { find, open, save, copy, burn };
  useEffect(() => {
    onActions({ run: () => void latest.current.find(false), open: () => void latest.current.open(), save: () => void latest.current.save(), copy: () => void latest.current.copy(), burn: () => latest.current.burn() });
    return () => onActions(null);
  }, [onActions]);

  const read = at ? readings(at, options.order === 'little') : [];
  const worded = (name: string) => ((WORDED_READINGS as readonly string[]).includes(name) ? t(`dev.hex.reading.${name}`) : name);

  return (
    <>
      <div className={frame.options}>
        <Choice label={t('dev.hex.perRow')} value={options.perRow} options={PER_ROW.map((value) => ({ value, label: value }))} onChange={(value) => change({ perRow: value })} />
        <Choice label={t('dev.hex.letters')} value={options.letters} options={LETTERS.map((value) => ({ value, label: t(`dev.hex.letters.${value}`) }))} onChange={(value) => change({ letters: value })} />
        <Choice label={t('dev.hex.offsets')} value={options.offsets} options={OFFSETS.map((value) => ({ value, label: t(`dev.hex.offsets.${value}`) }))} onChange={(value) => change({ offsets: value })} />
        <form className={styles.form} onSubmit={goTo}>
          <TextBox label={t('dev.hex.goTo')} value={goingTo} hint={t('dev.hex.goToHint')} code onChange={setGoingTo} />
          <button type="submit" className={frame.action} disabled={!shown}>
            <Icon name="arrow-right" size={12} />
            {t('dev.hex.go')}
          </button>
        </form>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void find(false);
          }}
        >
          <Choice label={t('dev.hex.find')} value={options.soughtAs} options={SOUGHT_AS.map((value) => ({ value, label: t(`dev.hex.soughtAs.${value}`) }))} onChange={(value) => change({ soughtAs: value })} />
          <TextBox label="" value={sought} hint={t(`dev.hex.soughtHint.${options.soughtAs === 'hex' ? 'hex' : 'text'}`)} wide code onChange={setSought} />
          {options.soughtAs === 'text' && <Toggle label={t('dev.hex.anyCase')} checked={options.anyCase} onChange={(anyCase) => change({ anyCase })} />}
          <button type="button" className={frame.action} disabled={!shown || working !== null} onClick={() => void find(true)}>
            <Icon name="chevron-up" size={12} />
            {t('dev.hex.previous')}
          </button>
          <button type="submit" className={frame.action} disabled={!shown || working !== null}>
            <Icon name="chevron-down" size={12} />
            {t('dev.hex.next')}
          </button>
        </form>
      </div>

      <div className={styles.body}>
        <section className={frame.pane} aria-label={t('dev.hex.bytes')} style={{ position: 'relative', flex: 1 }}>
          <div className={frame.paneHead}>
            <span className={frame.paneTitle}>{shown?.name ?? t('dev.hex.bytes')}</span>
            {shown && <span className={frame.paneFacts}>{t('dev.hex.size', { size: formatBytes(shown.size, language), bytes: count(shown.size) })}</span>}
            <span className={frame.spring} />
            <button type="button" className={frame.action} onClick={() => void open()}>
              <Icon name="folder-open" size={13} />
              {t('dev.frame.openFile')}
            </button>
            <button type="button" className={frame.action} onClick={paste}>
              <Icon name="paste" size={13} />
              {t('dev.frame.paste')}
            </button>
          </div>
          {shown === null ? (
            <div className={frame.blank}>{t('dev.hex.empty')}</div>
          ) : shown.size === 0 ? (
            <div className={frame.blank}>{t('dev.hex.noBytes')}</div>
          ) : (
            <HexView ref={view} host={host} hex={shown.hex} size={shown.size} perRow={perRow} offsets={options.offsets} letters={options.letters} picked={picked} onPick={setPicked} label={t('dev.hex.bytes')} onProblem={(error) => setTold({ key: problemKey(error), problem: true })} />
          )}
          {working !== null && <ToolProgress host={host} title={working} />}
        </section>

        <aside className={styles.side} aria-label={t('dev.hex.picked')}>
          <div className={frame.paneHead}>
            <span className={frame.paneTitle}>{t('dev.hex.picked')}</span>
          </div>
          {!shown || !picked ? (
            <p className={styles.note}>{t('dev.hex.pickHint')}</p>
          ) : (
            <>
              <dl className={styles.facts}>
                <div>
                  <dt>{t('dev.hex.place')}</dt>
                  <dd dir="ltr">
                    {offsetText(low, 'hex', shown.size)} · {count(low)}
                  </dd>
                </div>
                {high > low && (
                  <div>
                    <dt>{t('dev.hex.length')}</dt>
                    <dd dir="ltr">
                      {t('dev.hex.lengthOf', { bytes: count(high - low + 1), hex: (high - low + 1).toString(16).toUpperCase() })}
                    </dd>
                  </div>
                )}
              </dl>
              <div className={styles.copying}>
                <Choice label={t('dev.hex.copyAs')} value={options.form} options={FORMS.map((value) => ({ value, label: t(`dev.hex.form.${value}`) }))} onChange={(form) => change({ form })} />
                <span className={styles.buttons}>
                  <button type="button" className={frame.action} disabled={!has} onClick={() => void copy()}>
                    <Icon name="copy" size={13} />
                    {t('dev.frame.copy')}
                  </button>
                  <button type="button" className={frame.action} disabled={!has || working !== null} onClick={() => void save()}>
                    <Icon name="floppy-disk" size={13} />
                    {t('dev.frame.saveFile')}
                  </button>
                </span>
              </div>
              <div className={styles.reads}>
                <Choice label={t('dev.hex.order')} value={options.order} options={ORDERS.map((value) => ({ value, label: t(`dev.hex.order.${value}`) }))} onChange={(order) => change({ order })} />
                <dl className={styles.readings}>
                  {read.map((reading) => (
                    <div key={reading.name}>
                      <dt>{worded(reading.name)}</dt>
                      <dd dir="ltr" data-none={reading.value === null}>
                        {reading.value ?? '–'}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </>
          )}
        </aside>
      </div>

      <div className={frame.status} role="status">
        <span>{t('dev.hex.notChanged')}</span>
        <span className={frame.spring} />
        {told && (
          <span className={frame.last} data-problem={told.problem === true}>
            {t(told.key, told.values)}
          </span>
        )}
        <button type="button" className={frame.burn} data-tooltip={t('dev.hint.burn')} onClick={burn}>
          <Icon name="trash-can" size={12} />
          {t('dev.frame.burn')}
        </button>
      </div>
    </>
  );
}
