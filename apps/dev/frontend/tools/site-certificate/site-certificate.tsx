import { useI18n } from '@syntelab/i18n';
import { editorPhrases, TextEditor } from '@syntelab/text-editor';
import type { TextEditorHandle } from '@syntelab/text-editor';
import { Icon } from '@syntelab/ui-kit';
import { useEffect, useMemo, useRef, useState } from 'react';
import { problemKey, saveText } from '../../api/dev-api';
import { AskTool } from '../../frame/ask-tool';
import type { Told } from '../../frame/ask-tool';
import { Choice } from '../../frame/choice';
import { TextBox } from '../../frame/toggle';
import frame from '../../frame/tool-frame.module.css';
import type { ToldCertificate } from '../keys/keys-told';
import { hostAndPort } from '../network/net-text';
import styles from '../network/net.module.css';
import { oneOf } from '../codec-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';

/** What the `net_certificate` command of the Rust side answers. */
type Answer =
  | {
      readonly ok: true;
      readonly host: string;
      readonly address: string;
      readonly protocol: string;
      readonly cipher: string;
      readonly alpn: string | null;
      /** Why the computer does not trust the certificates, as the library says it; null when it does. */
      readonly notTrusted: string | null;
      readonly certificates: readonly Partial<ToldCertificate>[];
      /** Everything the certificates say, as the certificate decoder writes it (JSON). */
      readonly details: string;
      readonly ms: number;
    }
  | { readonly ok: false; readonly error: { readonly code: string; readonly detail?: string } };

/** What is shown of an answer: what it comes to, everything the certificates say, or the certificates themselves. */
const VIEWS = ['summary', 'details', 'pem'] as const;
/** How the connection comes to TLS: from its first byte, or after the service is asked to go over to it (mail, FTP); `auto` goes by the port. */
const BEGINS = ['auto', 'tls', 'smtp', 'imap', 'pop3', 'ftp'] as const;
const NO_FACTS = () => {};

/**
 * The certificates a site shows when a secure connection is made to it:
 * whom they are for, who signed them, how long they hold, whether this
 * computer trusts them (and why not), and what the connection agreed on.
 * Only the handshake of TLS is done: no request is sent to the site. The
 * site is the one typed, and it is asked only when the button is pressed.
 */
export default function SiteCertificate({ host, layout, onActions }: ToolProps) {
  const { t, language } = useI18n();
  const [options, change] = useOptions(host, 'site-certificate.options', (value) => ({ begin: oneOf(BEGINS, stored(value).begin) }));
  // Not kept between uses: what is typed into a tool never is.
  const [site, setSite] = useState('');
  const [name, setName] = useState('');
  const [answer, setAnswer] = useState<Extract<Answer, { ok: true }> | null>(null);
  const [problem, setProblem] = useState<{ code: string; detail?: string } | null>(null);
  const [told, setTold] = useState<Told | null>(null);
  const [working, setWorking] = useState(false);
  const [view, setView] = useState<(typeof VIEWS)[number]>('summary');
  const shown = useRef<TextEditorHandle>(null);
  const sequence = useRef(0);
  const phrases = useMemo(() => editorPhrases(t), [t]);
  const count = (value: number) => new Intl.NumberFormat(language).format(value);
  const day = (seconds: number) => new Intl.DateTimeFormat(language, { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(seconds * 1000));
  const now = Date.now() / 1000;
  const asked = hostAndPort(site, 443);
  const pem = answer?.certificates.map((certificate) => certificate.pem ?? '').join('') ?? '';

  const run = async () => {
    if (!asked) return;
    const mine = ++sequence.current;
    setTold(null);
    setWorking(true);
    try {
      const got = await host.invoke<Answer>('net_certificate', { host: asked.host, port: asked.port, name: name.trim() === '' ? undefined : name.trim(), begin: options.begin, timeoutSeconds: 15 });
      if (mine !== sequence.current) return;
      setAnswer(got.ok ? got : null);
      setProblem(got.ok ? null : got.error);
    } catch (error) {
      if (mine === sequence.current) setTold({ key: problemKey(error), problem: true });
    } finally {
      if (mine === sequence.current) setWorking(false);
    }
  };

  // The pane of text shows what the view chosen is of.
  useEffect(() => {
    if (view !== 'summary') shown.current?.show(view === 'details' ? (answer?.details ?? '') : pem);
  }, [view, answer]);

  const burn = () => {
    sequence.current += 1;
    setWorking(false);
    setSite('');
    setName('');
    setAnswer(null);
    setProblem(null);
    setView('summary');
    setTold({ key: 'dev.frame.burnt' });
  };

  const copy = () => {
    if (!answer) return;
    void navigator.clipboard.writeText(view === 'details' ? answer.details : pem).then(
      () => setTold({ key: 'dev.frame.copied' }),
      () => setTold({ key: 'dev.problem.clipboard', problem: true }),
    );
  };

  const save = async () => {
    if (!answer) return;
    const details = view === 'details';
    const path = await host.pickSavePath({ typeName: t('dev.keys.files'), extension: details ? 'json' : 'pem', suggestedName: `${answer.host}.${details ? 'json' : 'pem'}` });
    if (path === null) return;
    try {
      await saveText(host, path, details ? answer.details : pem);
      setTold({ key: 'dev.frame.saved', values: { path } });
    } catch (error) {
      setTold({ key: problemKey(error), problem: true });
    }
  };

  return (
    <AskTool
      host={host}
      onActions={onActions}
      actions={{ copy, save: () => void save() }}
      asked={
        <>
          <TextBox label={t('dev.site.site')} value={site} hint={t('dev.site.siteHint')} wide code onChange={setSite} />
          <TextBox label={t('dev.site.name')} value={name} hint={t('dev.site.nameHint')} code onChange={setName} />
          <Choice label={t('dev.site.begin')} value={options.begin} options={BEGINS.map((value) => ({ value, label: value === 'auto' ? t('dev.site.begin.auto') : value === 'tls' ? 'TLS' : value.toUpperCase() }))} onChange={(begin) => change({ begin })} />
        </>
      }
      runLabel={t('dev.site.run')}
      ready={!working && asked !== null}
      onRun={() => void run()}
      working={working ? t('dev.site.working') : null}
      told={told}
      note={t('dev.site.note')}
      onBurn={burn}
    >
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
        problem === null && <div className={frame.blank}>{t('dev.site.empty')}</div>
      ) : (
        <>
          <div className={frame.paneHead}>
            <span role="radiogroup" aria-label={t('dev.site.view')} className={frame.shows}>
              {VIEWS.map((value) => (
                <button key={value} type="button" role="radio" aria-checked={view === value} onClick={() => setView(value)}>
                  {t(`dev.site.view.${value}`)}
                </button>
              ))}
            </span>
            <span className={frame.spring} />
            <button type="button" className={frame.action} onClick={copy}>
              <Icon name="copy" size={13} />
              {t(view === 'details' ? 'dev.frame.copy' : 'dev.site.copyPem')}
            </button>
            <button type="button" className={frame.action} onClick={() => void save()}>
              <Icon name="floppy-disk" size={13} />
              {t('dev.frame.saveFile')}
            </button>
          </div>
          <div className={answer.notTrusted === null ? frame.fine : frame.wrong} role="status">
            <Icon name={answer.notTrusted === null ? 'circle-check' : 'triangle-exclamation'} size={15} />
            <span className={frame.wrongTexts}>
              <span className={frame.wrongMessage}>{t(answer.notTrusted === null ? 'dev.site.trusted' : 'dev.site.notTrusted')}</span>
              {answer.notTrusted !== null && <span dir="ltr">{answer.notTrusted}</span>}
            </span>
          </div>
          {view === 'summary' ? (
            <div className={styles.scroll}>
              <dl className={styles.facts}>
                <div>
                  <dt>{t('dev.net.address')}</dt>
                  <dd dir="ltr">{answer.address}</dd>
                </div>
                <div>
                  <dt>{t('dev.site.connection')}</dt>
                  <dd dir="ltr">
                    {answer.protocol} · {answer.cipher}
                    {answer.alpn !== null && ` · ${answer.alpn}`} · {t('dev.net.ms', { ms: count(answer.ms) })}
                  </dd>
                </div>
              </dl>
              {answer.certificates.map((certificate, index) => (
                <dl key={certificate.sha256 ?? index} className={styles.facts}>
                  <div>
                    <dt>{t(index === 0 ? 'dev.site.own' : 'dev.site.signer', { number: String(index) })}</dt>
                    <dd dir="ltr">{certificate.subject ?? '–'}</dd>
                  </div>
                  <div>
                    <dt>{t('dev.keys.fact.issuer')}</dt>
                    <dd dir="ltr">{certificate.selfSigned ? t('dev.keys.fact.selfSigned') : (certificate.issuer ?? '–')}</dd>
                  </div>
                  {certificate.notBefore !== undefined && certificate.notAfter !== undefined && (
                    <div>
                      <dt>{t('dev.keys.fact.holds')}</dt>
                      <dd data-wrong={certificate.notAfter < now || certificate.notBefore > now}>
                        {day(certificate.notBefore)} – {day(certificate.notAfter)} (UTC) ·{' '}
                        {certificate.notAfter < now ? t('dev.keys.fact.expired') : t('dev.site.daysLeft', { days: count(Math.floor((certificate.notAfter - now) / 86_400)) })}
                      </dd>
                    </div>
                  )}
                  {certificate.kind && (
                    <div>
                      <dt>{t('dev.keys.fact.public')}</dt>
                      <dd>{t('dev.keys.fact.kind', { kind: certificate.kind, bits: String(certificate.bits ?? 0) })}</dd>
                    </div>
                  )}
                  <div>
                    <dt>SHA-256</dt>
                    <dd dir="ltr">{certificate.sha256 ?? '–'}</dd>
                  </div>
                </dl>
              ))}
            </div>
          ) : (
            <div className={styles.editor}>
              <TextEditor key={view} ref={shown} initialText={view === 'details' ? answer.details : pem} wrap={layout.wrap} lineNumbers={layout.lineNumbers} readOnly syntax={view === 'details' ? 'json' : undefined} phrases={phrases} onFacts={NO_FACTS} />
            </div>
          )}
        </>
      )}
    </AskTool>
  );
}
