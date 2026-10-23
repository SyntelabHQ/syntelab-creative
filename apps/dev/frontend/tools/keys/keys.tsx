import { useI18n } from '@syntelab/i18n';
import { fileName } from '@syntelab/shell-api';
import { Icon } from '@syntelab/ui-kit';
import { useContext, useEffect, useRef, useState } from 'react';
import { problemKey, saveText } from '../../api/dev-api';
import { Choice } from '../../frame/choice';
import { formatDuration } from '../../frame/format';
import { LaunchedFiles } from '../../frame/launched-files';
import { NumberBox } from '../../frame/number-box';
import { TextBox, Toggle } from '../../frame/toggle';
import frame from '../../frame/tool-frame.module.css';
import { oneOf } from '../codec-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';
import { KeysResults } from './keys-results';
import type { Told } from './keys-results';
import { KINDS, namesOf, outputsOf, resultOf, RSA_SIZES } from './keys-told';
import type { KeysAnswer, KeysResult, Kind } from './keys-told';
import styles from './keys.module.css';

/** What is done: a key made, a request or a certificate made for a key, a request signed by an authority of one's own, or something read and written again. */
const MODES = ['make', 'request', 'certificate', 'sign', 'read'] as const;
type Mode = (typeof MODES)[number];
/** The key a request or a certificate is for: a new one, or one that is given. */
const KEY_SOURCES = ['new', 'given'] as const;
const SIZES = [...RSA_SIZES, 'other'] as const;

interface Options {
  readonly mode: Mode;
  readonly kind: Kind;
  readonly size: (typeof SIZES)[number];
  /** The size of an RSA key when it is none of those offered. */
  readonly bits: number;
  readonly keySource: (typeof KEY_SOURCES)[number];
  readonly days: number;
  /** The certificate may sign others (a root of one's own). */
  readonly authority: boolean;
}

const readOptions = (value: unknown): Options => {
  const { mode, kind, size, bits, keySource, days, authority } = stored(value);
  const whole = (given: unknown, otherwise: number) => (typeof given === 'number' && Number.isInteger(given) && given >= 1 ? given : otherwise);
  return { mode: oneOf(MODES, mode), kind: oneOf(KINDS, kind), size: oneOf(SIZES, size), bits: whole(bits, 3072), keySource: oneOf(KEY_SOURCES, keySource), days: whole(days, 365), authority: authority === true };
};

/** Whom a request or a certificate is for, as it is typed. */
const NO_SUBJECT = { commonName: '', organization: '', unit: '', locality: '', state: '', country: '', email: '' };
const SUBJECT_FIELDS = ['commonName', 'organization', 'unit', 'locality', 'state', 'country', 'email'] as const;

/**
 * Keys and certificates. A key is made (RSA, the NIST curves, Ed25519) and
 * given in every form programs take; a request for a certificate, or a
 * certificate signed with its own key, is made for a new key or for one
 * that is given; a request is signed by an authority of one's own (a
 * certificate that may sign others, and its key); and whatever is given (PEM, DER, an OpenSSH key, a .pfx
 * file) is read by what it is and written again in the other forms.
 *
 * All of it is done on this computer, by the Rust side. Nothing typed or
 * made here is kept: a key is in the tab until Burn, and nowhere else
 * unless the user saves it.
 */
export default function Keys({ host, onActions }: ToolProps) {
  const { t, language } = useI18n();
  const [options, change] = useOptions(host, 'keys.options', readOptions);
  const given = useContext(LaunchedFiles);
  /** A file the tool was opened with from outside the program is read, whatever was done here the last time. */
  const [mode, setMode] = useState<Mode>(given?.files[0] !== undefined ? 'read' : options.mode);
  // Not kept between uses: what is typed into a tool never is, and a key least of all.
  const [subject, setSubject] = useState(NO_SUBJECT);
  const [names, setNames] = useState('');
  const [comment, setComment] = useState('');
  /** Locks what is written. */
  const [lock, setLock] = useState('');
  /** A key that is given, and what opens it. */
  const [keyText, setKeyText] = useState('');
  /** What an authority signs, and the authority: its certificate (its key is `keyText`). */
  const [requestText, setRequestText] = useState('');
  const [authorityText, setAuthorityText] = useState('');
  const [passphrase, setPassphrase] = useState('');
  /** What is read: a text, or a file read from where it is. */
  const [readText, setReadText] = useState('');
  const [readPath, setReadPath] = useState<string | null>(given?.files[0] ?? null);
  const [result, setResult] = useState<KeysResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [told, setTold] = useState<Told | null>(null);
  const [working, setWorking] = useState(false);
  const sequence = useRef(0);

  const choose = (next: Mode) => {
    setMode(next);
    change({ mode: next });
    setResult(null);
    setProblem(null);
  };

  const bits = options.size === 'other' ? options.bits : Number(options.size);
  const making = { kind: options.kind, bits };
  const forKey = mode === 'request' || mode === 'certificate';
  const newKey = mode === 'make' || (forKey && options.keySource === 'new');

  /** Runs what `doing` says: the mode chosen, unless a file was just opened to be read. */
  const run = async (path: string | null = readPath, doing: Mode = mode) => {
    if (working) return;
    const mine = ++sequence.current;
    setTold(null);
    setWorking(true);
    const locking = lock === '' ? undefined : lock;
    try {
      const answer =
        doing === 'make'
          ? await host.invoke<KeysAnswer>('keys_make', { ...making, comment, lock: locking })
          : doing === 'sign'
            ? await host.invoke<KeysAnswer>('keys_sign', { request: requestText, certificate: authorityText, key: keyText, passphrase: passphrase === '' ? undefined : passphrase, days: options.days, authority: options.authority })
          : doing === 'read'
            ? await host.invoke<KeysAnswer>('keys_read', { ...(path !== null ? { path } : { text: readText }), passphrase: passphrase === '' ? undefined : passphrase, lock: locking, comment: comment === '' ? undefined : comment })
            : await host.invoke<KeysAnswer>('keys_request', {
                ...(options.keySource === 'given' ? { key: keyText, passphrase: passphrase === '' ? undefined : passphrase } : { make: making }),
                subject,
                names: namesOf(names),
                selfSigned: doing === 'certificate' ? { days: options.days, authority: options.authority } : undefined,
                lock: locking,
              });
      if (mine !== sequence.current) return;
      if (answer.ok) {
        setResult(resultOf(answer));
        setProblem(null);
      } else {
        setResult(null);
        setProblem(answer.error.code);
      }
    } catch (error) {
      if (mine !== sequence.current) return;
      setResult(null);
      setTold({ key: problemKey(error), problem: true });
    } finally {
      if (mine === sequence.current) setWorking(false);
    }
  };

  const open = async () => {
    const [path] = await host.pickFiles({ typeName: t('dev.keys.files'), extensions: ['*'] });
    if (path === undefined) return;
    choose('read');
    setReadPath(path);
    setReadText('');
    // The mode chosen a moment ago is not yet the one `run` sees.
    void run(path, 'read');
  };

  // A file the tool was opened with is read at once.
  const taken = useRef(false);
  useEffect(() => {
    if (taken.current || given?.files[0] === undefined) return;
    taken.current = true;
    void run(given.files[0]);
  }, []);

  const burn = () => {
    sequence.current += 1;
    setWorking(false);
    setSubject(NO_SUBJECT);
    setNames('');
    setComment('');
    setLock('');
    setKeyText('');
    setRequestText('');
    setAuthorityText('');
    setPassphrase('');
    setReadText('');
    setReadPath(null);
    setResult(null);
    setProblem(null);
    setTold({ key: 'dev.frame.burnt' });
  };

  /** A text of the result written to a file the user chooses. */
  const save = async (text: string, name: string) => {
    const dot = name.lastIndexOf('.');
    const path = await host.pickSavePath({ typeName: t('dev.keys.files'), extension: dot > 0 ? name.slice(dot + 1) : '', suggestedName: name });
    if (path === null) return;
    try {
      await saveText(host, path, text);
      setTold({ key: 'dev.frame.saved', values: { path } });
    } catch (error) {
      setTold({ key: problemKey(error), problem: true });
    }
  };

  /** What is given written as bytes: DER, or a PKCS #12 file. */
  const write = async (form: 'der' | 'pkcs12', text: string, name: string, more: Readonly<Record<string, unknown>> = {}) => {
    const path = await host.pickSavePath({ typeName: t('dev.keys.files'), extension: name.slice(name.lastIndexOf('.') + 1), suggestedName: name });
    if (path === null) return;
    try {
      // A key that was written locked is opened again with what locked it. Signing writes nothing locked: its box is not shown.
      const locked = mode !== 'sign' && lock !== '';
      const answer = await host.invoke<{ ok: true } | { ok: false; error: { code: string } }>('keys_write', { form, text, passphrase: locked ? lock : undefined, out: path, ...more });
      setTold(answer.ok ? { key: 'dev.frame.saved', values: { path } } : { key: `dev.keys.problem.${answer.error.code}`, problem: true });
    } catch (error) {
      setTold({ key: problemKey(error), problem: true });
    }
  };

  /** What the commands Copy and Save take: the first thing the results show (the key made, the certificate, the request). */
  const first = result === null ? undefined : outputsOf(result)[0];
  const copyFirst = () => {
    if (first === undefined) return;
    void navigator.clipboard.writeText(first.text).then(
      () => setTold({ key: 'dev.frame.copied' }),
      () => setTold({ key: 'dev.problem.clipboard', problem: true }),
    );
  };
  const saveFirst = () => {
    if (first !== undefined) void save(first.text, first.fileName);
  };

  // The commands of the program reach what these do now, not what they did when they were made.
  const latest = useRef({ run, open, burn, copyFirst, saveFirst });
  latest.current = { run, open, burn, copyFirst, saveFirst };
  useEffect(() => {
    onActions({ run: () => void latest.current.run(), open: () => void latest.current.open(), save: () => latest.current.saveFirst(), copy: () => latest.current.copyFirst(), burn: () => latest.current.burn() });
    return () => onActions(null);
  }, [onActions]);

  const ready = !working && (mode !== 'read' || readPath !== null || readText.trim() !== '') && (!forKey || options.keySource === 'new' || keyText.trim() !== '') && (mode !== 'sign' || (requestText.trim() !== '' && authorityText.trim() !== '' && keyText.trim() !== ''));

  return (
    <>
      <div className={frame.options}>
        <Choice label={t('dev.keys.mode')} value={mode} options={MODES.map((value) => ({ value, label: t(`dev.keys.mode.${value}`) }))} onChange={choose} />
        <span className={frame.spring} />
        <button type="button" className={frame.run} disabled={!ready} data-tooltip={t('dev.hint.run')} onClick={() => void run()}>
          <Icon name="bolt" size={13} />
          {t(`dev.keys.run.${mode}`)}
        </button>
      </div>

      <div className={styles.body}>
        <section className={styles.form} aria-label={t('dev.keys.asked')}>
          {forKey && (
            <div className={styles.group}>
              <Choice label={t('dev.keys.keySource')} value={options.keySource} options={KEY_SOURCES.map((value) => ({ value, label: t(`dev.keys.keySource.${value}`) }))} onChange={(keySource) => change({ keySource })} />
            </div>
          )}
          {newKey && (
            <div className={styles.group}>
              <Choice label={t('dev.keys.kind')} value={options.kind} options={KINDS.map((value) => ({ value, label: t(`dev.keys.kind.${value}`) }))} onChange={(kind) => change({ kind })} />
              {options.kind === 'rsa' && (
                <>
                  <Choice label={t('dev.keys.size')} value={options.size} options={SIZES.map((value) => ({ value, label: value === 'other' ? t('dev.keys.size.other') : value }))} onChange={(size) => change({ size })} />
                  {options.size === 'other' && <NumberBox label={t('dev.keys.bits')} value={options.bits} most={Number.MAX_SAFE_INTEGER} onChange={(value) => change({ bits: Math.max(value, 1) })} />}
                  {bits >= 8192 && <p className={styles.note}>{t('dev.keys.slow')}</p>}
                </>
              )}
            </div>
          )}
          {forKey && options.keySource === 'given' && (
            <div className={styles.group}>
              <label className={styles.area}>
                <span>{t('dev.keys.keyText')}</span>
                <textarea value={keyText} spellCheck={false} autoComplete="off" placeholder={t('dev.keys.keyTextHint')} onChange={(event) => setKeyText(event.target.value)} />
              </label>
              <TextBox label={t('dev.keys.passphrase')} value={passphrase} hidden hint={t('dev.keys.passphraseHint')} onChange={setPassphrase} />
            </div>
          )}
          {forKey && (
            <div className={styles.group}>
              <span className={styles.heading}>{t('dev.keys.subject')}</span>
              {SUBJECT_FIELDS.map((field) => (
                <TextBox key={field} label={t(`dev.keys.subject.${field}`)} value={subject[field]} hint={t(`dev.keys.subjectHint.${field}`)} onChange={(value) => setSubject((before) => ({ ...before, [field]: value }))} />
              ))}
              <label className={styles.area}>
                <span>{t('dev.keys.names')}</span>
                <textarea value={names} spellCheck={false} autoComplete="off" placeholder={t('dev.keys.namesHint')} onChange={(event) => setNames(event.target.value)} />
              </label>
            </div>
          )}
          {mode === 'sign' && (
            <div className={styles.group}>
              <label className={styles.area}>
                <span>{t('dev.keys.sign.request')}</span>
                <textarea value={requestText} spellCheck={false} autoComplete="off" placeholder="-----BEGIN CERTIFICATE REQUEST-----" onChange={(event) => setRequestText(event.target.value)} />
              </label>
              <label className={styles.area}>
                <span>{t('dev.keys.sign.certificate')}</span>
                <textarea value={authorityText} spellCheck={false} autoComplete="off" placeholder="-----BEGIN CERTIFICATE-----" onChange={(event) => setAuthorityText(event.target.value)} />
              </label>
              <label className={styles.area}>
                <span>{t('dev.keys.sign.key')}</span>
                <textarea value={keyText} spellCheck={false} autoComplete="off" placeholder={t('dev.keys.keyTextHint')} onChange={(event) => setKeyText(event.target.value)} />
              </label>
              <TextBox label={t('dev.keys.passphrase')} value={passphrase} hidden hint={t('dev.keys.passphraseHint')} onChange={setPassphrase} />
            </div>
          )}
          {(mode === 'certificate' || mode === 'sign') && (
            <div className={styles.group}>
              <NumberBox label={t('dev.keys.days')} value={options.days} most={Number.MAX_SAFE_INTEGER} onChange={(days) => change({ days: Math.max(days, 1) })} />
              <Toggle label={t(mode === 'sign' ? 'dev.keys.sign.authority' : 'dev.keys.authority')} checked={options.authority} onChange={(authority) => change({ authority })} />
            </div>
          )}
          {mode === 'read' && (
            <div className={styles.group}>
              {readPath !== null ? (
                <div className={styles.file}>
                  <Icon name="file" size={14} />
                  <bdi>{fileName(readPath)}</bdi>
                  <button type="button" className={frame.action} onClick={() => setReadPath(null)}>
                    <Icon name="xmark" size={12} />
                    {t('dev.frame.clear')}
                  </button>
                </div>
              ) : (
                <label className={styles.area} data-tall="true">
                  <span>{t('dev.keys.readText')}</span>
                  <textarea value={readText} spellCheck={false} autoComplete="off" placeholder={t('dev.keys.readTextHint')} onChange={(event) => setReadText(event.target.value)} />
                </label>
              )}
              <button type="button" className={frame.action} onClick={() => void open()}>
                <Icon name="folder-open" size={13} />
                {t('dev.frame.openFile')}
              </button>
              <TextBox label={t('dev.keys.passphrase')} value={passphrase} hidden hint={t('dev.keys.passphraseHint')} onChange={setPassphrase} />
            </div>
          )}
          {mode !== 'sign' && (
          <div className={styles.group}>
            <span className={styles.heading}>{t('dev.keys.written')}</span>
            <TextBox label={t('dev.keys.lock')} value={lock} hidden hint={t('dev.keys.lockHint')} onChange={setLock} />
            {mode !== 'request' && mode !== 'certificate' && <TextBox label={t('dev.keys.comment')} value={comment} hint={t('dev.keys.commentHint')} onChange={setComment} />}
          </div>
          )}
        </section>

        <section className={styles.results} aria-label={t('dev.frame.output')}>
          {working && (
            <div className={frame.fileNote} role="status">
              <Icon name="rotate" size={15} />
              <span className={frame.fileTexts}>
                <span className={frame.fileName}>{t('dev.keys.working')}</span>
              </span>
            </div>
          )}
          {problem !== null && (
            <div className={frame.wrong} role="alert">
              <Icon name="triangle-exclamation" size={15} />
              <span className={frame.wrongTexts}>
                <span className={frame.wrongMessage}>{t(`dev.keys.problem.${problem}`)}</span>
              </span>
            </div>
          )}
          {result === null ? !working && problem === null && <div className={frame.blank}>{t(`dev.keys.empty.${mode}`)}</div> : <KeysResults result={result} took={result.ms === null ? null : formatDuration(result.ms, language)} onSave={save} onWrite={write} onTold={setTold} />}
        </section>
      </div>

      <div className={frame.status} role="status">
        <span>{t('dev.keys.notKept')}</span>
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
