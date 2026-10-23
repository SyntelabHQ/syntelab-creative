import { useI18n } from '@syntelab/i18n';
import { fileName } from '@syntelab/shell-api';
import { editorPhrases, TextEditor } from '@syntelab/text-editor';
import type { TextEditorHandle } from '@syntelab/text-editor';
import { Icon } from '@syntelab/ui-kit';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fileAsBase64, forgetResult, keepResult, newResultFile, problemKey, saveText, stopWork } from '../../api/dev-api';
import { AskTool } from '../../frame/ask-tool';
import { BytesPreview } from '../../frame/bytes-preview';
import type { Told } from '../../frame/ask-tool';
import { Choice } from '../../frame/choice';
import { formatBytes, formatDuration } from '../../frame/format';
import { NumberBox } from '../../frame/number-box';
import { COPIED_MOST } from '../../frame/result-file';
import { TextBox, Toggle } from '../../frame/toggle';
import frame from '../../frame/tool-frame.module.css';
import { oneOf } from '../codec-tool';
import { curlOf, headersOf, statusKind, syntaxOf } from '../network/net-text';
import styles from '../network/net.module.css';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
/** What is shown of an answer: its body, or its headers. */
const VIEWS = ['body', 'headers'] as const;
/** How many times a request is sent on to where the server points, when the user lets it be. */
const SENT_ON_MOST = 20;
const NO_FACTS = () => {};

/** What the `net_http` command of the Rust side answers. */
type Answer =
  | {
      readonly ok: true;
      readonly status: number;
      readonly reason: string;
      readonly version: string;
      readonly headers: readonly (readonly [string, string])[];
      /** The address that answered, and those the request was sent on from before it. */
      readonly url: string;
      readonly sentOnFrom: readonly string[];
      readonly size: number;
      readonly msToHeaders: number;
      readonly ms: number;
      readonly text?: string;
      /** The body is not text. */
      readonly binary?: boolean;
      /** The body is larger than what is shown: only its beginning is here. */
      readonly tooLarge?: boolean;
      readonly saved?: boolean;
      /** The body, not text, was written whole to the result file given (`keep`), to be shown from there. */
      readonly kept?: boolean;
    }
  | { readonly ok: false; readonly error: { readonly code: string; readonly detail?: string } };

interface Options {
  readonly method: (typeof METHODS)[number];
  readonly follow: boolean;
  readonly verifyTls: boolean;
  /** In seconds; 0 waits as long as it takes. */
  readonly timeout: number;
  /** A body that is JSON is shown laid out. */
  readonly pretty: boolean;
}

const readOptions = (value: unknown): Options => {
  const { method, follow, verifyTls, timeout, pretty } = stored(value);
  return { method: oneOf(METHODS, method), follow: follow !== false, verifyTls: verifyTls !== false, timeout: typeof timeout === 'number' && Number.isInteger(timeout) && timeout >= 0 ? timeout : 30, pretty: pretty !== false };
};

/**
 * One request to a server, written by hand: its method, its address, its
 * headers and its body; and what came back: the number of the answer, its
 * headers, its body (laid out when it is JSON), how long it took and how
 * large it is. An answer of any size is written straight to a file.
 *
 * The request goes to the address typed, when Send is pressed, with what
 * is written here and nothing else; no cookie is kept from one request to
 * the next. Nothing typed here is kept, the address and the headers least
 * of all: they are where secrets are.
 */
export default function Http({ host, layout, onActions }: ToolProps) {
  const { t, language } = useI18n();
  const [options, change] = useOptions(host, 'http.options', readOptions);
  // Not kept between uses.
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState('');
  const [body, setBody] = useState('');
  /** A file sent as the body, in place of what is typed. */
  const [bodyFile, setBodyFile] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Extract<Answer, { ok: true }> | null>(null);
  /** The body as it is shown: laid out when it is JSON and that is asked for. */
  const [shownBody, setShownBody] = useState('');
  const [savedTo, setSavedTo] = useState<string | null>(null);
  /** The result file of the program's own that holds a body that is not text, shown from there. */
  const [kept, setKept] = useState<string | null>(null);
  const keptHeld = useRef<string | null>(null);
  const [problem, setProblem] = useState<{ code: string; detail?: string } | null>(null);
  const [told, setTold] = useState<Told | null>(null);
  const [working, setWorking] = useState(false);
  const [view, setView] = useState<(typeof VIEWS)[number]>('body');
  const editor = useRef<TextEditorHandle>(null);
  const sequence = useRef(0);
  const phrases = useMemo(() => editorPhrases(t), [t]);
  const count = (value: number) => new Intl.NumberFormat(language).format(value);

  const read = headersOf(headers);
  const request = { method: options.method, url: url.trim(), headers: read.pairs, body, bodyFile, follow: options.follow, verifyTls: options.verifyTls };
  const contentType = answer?.headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1];
  const syntax = syntaxOf(contentType);

  /** Holds another result file of a body, or none; the one held before is deleted. */
  const holdKept = (next: string | null) => {
    if (keptHeld.current !== null && keptHeld.current !== next) forgetResult(host, keptHeld.current);
    keptHeld.current = next;
    setKept(next);
  };
  useEffect(
    () => () => {
      if (keptHeld.current !== null) forgetResult(host, keptHeld.current);
    },
    [],
  );

  /** The body of an answer as it is shown: laid out by the tool that lays JSON out when that is asked for; left as it came when it is not JSON after all. */
  const layOut = async (got: Extract<Answer, { ok: true }>, pretty: boolean) => {
    const text = got.text ?? '';
    if (!pretty || text === '' || got.tooLarge || syntaxOf(got.headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1]) !== 'json') return text;
    const laid = await host.invoke<{ ok: boolean; text?: string }>('json', { mode: 'format', indent: '2', text }).catch(() => null);
    return laid?.ok && laid.text !== undefined ? laid.text : text;
  };

  // Laying JSON out or not is shown at once on the answer that came: it is not asked for again.
  const firstPretty = useRef(true);
  useEffect(() => {
    if (firstPretty.current) {
      firstPretty.current = false;
      return;
    }
    if (answer === null || working) return;
    const mine = sequence.current;
    void layOut(answer, options.pretty).then((text) => mine === sequence.current && setShownBody(text));
  }, [options.pretty]);

  /** Sends the request; with `out`, the body of the answer is written there and not shown. */
  const send = async (out?: string) => {
    if (read.bad !== null) return setTold({ key: 'dev.http.badHeader', values: { line: read.bad }, problem: true });
    const mine = ++sequence.current;
    setTold(null);
    setWorking(true);
    let keep: string | undefined;
    try {
      // A body that is not text is shown from a file of the program's own (a picture, a PDF…).
      if (out === undefined) keep = await newResultFile(host);
      const got = await host.invoke<Answer>('net_http', { method: request.method, url: request.url, headers: request.headers, body: bodyFile !== null || body === '' ? undefined : body, bodyFile: bodyFile ?? undefined, redirects: options.follow ? SENT_ON_MOST : 0, verifyTls: options.verifyTls, timeoutSeconds: options.timeout, out, keep });
      if (mine !== sequence.current || !got.ok || got.kept !== true) {
        if (keep !== undefined) forgetResult(host, keep);
        keep = undefined;
      }
      if (mine !== sequence.current) return;
      holdKept(keep ?? null);
      if (!got.ok) {
        setAnswer(null);
        setProblem(got.error);
        return;
      }
      setProblem(null);
      setAnswer(got);
      setSavedTo(got.saved ? (out ?? null) : null);
      setView('body');
      const text = await layOut(got, options.pretty);
      if (mine === sequence.current) setShownBody(text);
    } catch (error) {
      if (keep !== undefined) forgetResult(host, keep);
      if (mine === sequence.current) setTold({ key: problemKey(error), problem: true });
    } finally {
      if (mine === sequence.current) setWorking(false);
    }
  };

  // The pane of text shows the body.
  useEffect(() => {
    if (view === 'body') editor.current?.show(shownBody);
  }, [shownBody, view]);

  /** Sends the request once more, and writes the body of the answer to a file as it comes. */
  const sendToFile = async () => {
    const path = await host.pickSavePath({ typeName: t('dev.codec.anyFile'), extension: '', suggestedName: bodyName() });
    if (path !== null) await send(path);
  };

  const has = answer !== null && shownBody !== '';
  /** The body is bytes held in a file of the program's own: what is copied is their Base64. */
  const bytesShown = answer !== null && kept !== null;
  const canCopy = has || (bytesShown && answer.size <= COPIED_MOST);
  const copy = async () => {
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(bytesShown && kept !== null ? await fileAsBase64(host, kept) : shownBody);
      setTold({ key: bytesShown ? 'dev.frame.copiedBase64' : 'dev.frame.copied' });
    } catch {
      setTold({ key: 'dev.problem.clipboard', problem: true });
    }
  };
  /** The name the body is offered under: the last part of the address. */
  const bodyName = () => request.url.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() || 'response';
  const copyCurl = () =>
    void navigator.clipboard.writeText(curlOf(request)).then(
      () => setTold({ key: 'dev.frame.copied' }),
      () => setTold({ key: 'dev.problem.clipboard', problem: true }),
    );

  const save = async () => {
    if (bytesShown && kept !== null) {
      // The body that came is copied as it is: it is not asked for again.
      const path = await host.pickSavePath({ typeName: t('dev.codec.anyFile'), extension: '', suggestedName: bodyName() });
      if (path === null) return;
      try {
        await keepResult(host, kept, path);
        setSavedTo(path);
        setTold({ key: 'dev.frame.saved', values: { path } });
      } catch (error) {
        setTold({ key: problemKey(error), problem: true });
      }
      return;
    }
    if (!has || answer.tooLarge) return void sendToFile();
    const path = await host.pickSavePath({ typeName: t('dev.codec.anyFile'), extension: syntax ?? 'txt', suggestedName: `response.${syntax ?? 'txt'}` });
    if (path === null) return;
    try {
      await saveText(host, path, shownBody);
      setTold({ key: 'dev.frame.saved', values: { path } });
    } catch (error) {
      setTold({ key: problemKey(error), problem: true });
    }
  };

  const burn = () => {
    sequence.current += 1;
    if (working) void stopWork(host).catch(() => {});
    setWorking(false);
    setUrl('');
    setHeaders('');
    setBody('');
    setBodyFile(null);
    setAnswer(null);
    setShownBody('');
    setSavedTo(null);
    holdKept(null);
    setProblem(null);
    setTold({ key: 'dev.frame.burnt' });
  };

  return (
    <AskTool
      host={host}
      onActions={onActions}
      actions={{ copy: () => void copy(), save: () => void save() }}
      asked={
        <>
          <Choice label={t('dev.http.method')} value={options.method} options={METHODS.map((value) => ({ value, label: value }))} onChange={(method) => change({ method })} />
          <TextBox label={t('dev.http.url')} value={url} hint="https://example.com/api/items?page=1" wide code onChange={setUrl} />
        </>
      }
      more={
        <>
          <Toggle label={t('dev.http.follow')} checked={options.follow} onChange={(follow) => change({ follow })} />
          <Toggle label={t('dev.http.verifyTls')} checked={options.verifyTls} onChange={(verifyTls) => change({ verifyTls })} />
          <NumberBox label={t('dev.http.timeout')} value={options.timeout} most={86_400} onChange={(timeout) => change({ timeout })} />
          <Toggle label={t('dev.http.pretty')} checked={options.pretty} onChange={(pretty) => change({ pretty })} />
          <span className={frame.spring} />
          <button type="button" className={frame.action} disabled={request.url === ''} onClick={copyCurl}>
            <Icon name="copy" size={13} />
            {t('dev.http.copyCurl')}
          </button>
          <button type="button" className={frame.action} disabled={request.url === '' || working} onClick={() => void sendToFile()}>
            <Icon name="file-arrow-down" size={13} />
            {t('dev.http.sendToFile')}
          </button>
        </>
      }
      runLabel={t('dev.http.send')}
      ready={!working && request.url !== ''}
      onRun={() => void send()}
      working={working ? t('dev.http.working') : null}
      told={told}
      note={t('dev.http.note')}
      onBurn={burn}
    >
      <div className={styles.sides}>
        <div className={styles.request}>
          <label className={styles.area}>
            <span>{t('dev.http.headers')}</span>
            <textarea value={headers} spellCheck={false} autoComplete="off" placeholder={'Accept: application/json\nAuthorization: Bearer …'} onChange={(event) => setHeaders(event.target.value)} />
          </label>
          {bodyFile === null ? (
            <label className={styles.area} data-tall="true">
              <span>{t('dev.http.body')}</span>
              <textarea value={body} spellCheck={false} autoComplete="off" placeholder={t('dev.http.bodyHint')} onChange={(event) => setBody(event.target.value)} />
            </label>
          ) : (
            <div className={styles.area}>
              <span>{t('dev.http.bodyIsFile')}</span>
              <bdi style={{ color: 'var(--sc-text)', fontWeight: 600, overflowWrap: 'anywhere' }}>{fileName(bodyFile)}</bdi>
            </div>
          )}
          <span style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className={frame.action}
              onClick={() =>
                void host.pickFiles({ typeName: t('dev.codec.anyFile'), extensions: ['*'] }).then(([path]) => {
                  if (path !== undefined) setBodyFile(path);
                })
              }
            >
              <Icon name="folder-open" size={13} />
              {t('dev.http.bodyFromFile')}
            </button>
            {bodyFile !== null && (
              <button type="button" className={frame.action} onClick={() => setBodyFile(null)}>
                <Icon name="xmark" size={12} />
                {t('dev.http.bodyTyped')}
              </button>
            )}
          </span>
          {!options.verifyTls && <p className={styles.note} data-wrong="true" style={{ padding: 0 }}>{t('dev.http.notVerified')}</p>}
        </div>
        <div className={styles.response}>
          {problem !== null && (
            <div className={frame.wrong} role="alert">
              <Icon name="triangle-exclamation" size={15} />
              <span className={frame.wrongTexts}>
                <span className={frame.wrongMessage}>{t(`dev.net.problem.${problem.code}`)}</span>
                {problem.detail && <span dir="ltr">{problem.detail}</span>}
              </span>
            </div>
          )}
          {answer === null ? (
            problem === null && <div className={frame.blank}>{t('dev.http.empty')}</div>
          ) : (
            <>
              <div className={styles.status} role="status">
                <span className={styles.code} data-kind={statusKind(answer.status)} dir="ltr">
                  {answer.status} {answer.reason}
                </span>
                <span dir="ltr">{answer.version}</span>
                <span>{formatDuration(answer.ms, language)}</span>
                <span>{t('dev.http.toHeaders', { time: formatDuration(answer.msToHeaders, language) })}</span>
                <span>{formatBytes(answer.size, language)}</span>
                {answer.sentOnFrom.length > 0 && <span>{t('dev.http.sentOn', { count: count(answer.sentOnFrom.length) })}</span>}
              </div>
              {answer.sentOnFrom.length > 0 && (
                <p className={styles.note} dir="ltr" style={{ paddingBlockStart: 8 }}>
                  {[...answer.sentOnFrom, answer.url].join(' → ')}
                </p>
              )}
              <div className={frame.paneHead}>
                <span role="radiogroup" aria-label={t('dev.http.view')} className={frame.shows}>
                  {VIEWS.map((value) => (
                    <button key={value} type="button" role="radio" aria-checked={view === value} onClick={() => setView(value)}>
                      {t(`dev.http.view.${value}`, { count: count(answer.headers.length) })}
                    </button>
                  ))}
                </span>
                <span className={frame.spring} />
                <button type="button" className={frame.action} disabled={!canCopy} data-tooltip={bytesShown ? t('dev.hint.copyBase64') : undefined} onClick={() => void copy()}>
                  <Icon name="copy" size={13} />
                  {t(bytesShown ? 'dev.frame.copyBase64' : 'dev.frame.copy')}
                </button>
                <button type="button" className={frame.action} disabled={!has && !answer.binary && !answer.tooLarge} onClick={() => void save()}>
                  <Icon name="floppy-disk" size={13} />
                  {t('dev.frame.saveFile')}
                </button>
              </div>
              {savedTo !== null && (
                <div className={frame.fileNote}>
                  <Icon name="file" size={15} />
                  <span className={frame.fileTexts}>
                    <bdi className={frame.fileName}>{savedTo}</bdi>
                    <span>{t('dev.http.savedTo')}</span>
                  </span>
                  <button type="button" className={frame.action} onClick={() => void host.showInFolder(savedTo).catch(() => {})}>
                    <Icon name="folder-open" size={13} />
                    {t('dev.frame.showInFolder')}
                  </button>
                </div>
              )}
              {answer.binary && !bytesShown && <p className={styles.note} style={{ paddingBlockStart: 10 }}>{t('dev.http.binary')}</p>}
              {answer.tooLarge && <p className={styles.note} data-wrong="true" style={{ paddingBlockStart: 10 }}>{t('dev.http.tooLarge')}</p>}
              {view === 'headers' ? (
                <div className={styles.scroll}>
                  <table className={styles.table}>
                    <tbody>
                      {answer.headers.map(([name, value], index) => (
                        <tr key={index}>
                          <td data-quiet="true" dir="ltr">
                            {name}
                          </td>
                          <td data-code="true" dir="ltr">
                            {value}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : bytesShown && kept !== null ? (
                <BytesPreview host={host} path={kept} />
              ) : (
                <div className={styles.editor}>
                  <TextEditor ref={editor} initialText={shownBody} wrap={layout.wrap} lineNumbers={layout.lineNumbers} readOnly syntax={syntax} phrases={phrases} emptyHint={t(answer.saved ? 'dev.http.savedTo' : 'dev.http.noBody')} onFacts={NO_FACTS} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AskTool>
  );
}
