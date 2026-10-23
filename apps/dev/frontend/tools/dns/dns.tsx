import { useI18n } from '@syntelab/i18n';
import { useEffect, useRef, useState } from 'react';
import { problemKey, stopWork } from '../../api/dev-api';
import { AskTool } from '../../frame/ask-tool';
import type { Told } from '../../frame/ask-tool';
import { Choice } from '../../frame/choice';
import { TextBox, Toggle } from '../../frame/toggle';
import frame from '../../frame/tool-frame.module.css';
import { oneOf } from '../codec-tool';
import styles from '../network/net.module.css';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';

/** The kinds of record that can be asked for, the most asked first. */
const KINDS = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'PTR', 'SRV', 'CAA', 'DS', 'DNSKEY'] as const;
type Kind = (typeof KINDS)[number];
/** What "the usual ones" asks for in one go. */
const USUAL: readonly Kind[] = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'CAA'];
/** Whom to ask: the name server the computer is set to use, a public one, or one that is typed. */
const SERVERS = ['system', '1.1.1.1', '8.8.8.8', '9.9.9.9', 'doh-cloudflare', 'doh-google', 'other'] as const;
/** The resolvers asked over HTTPS, by the address each is asked at. */
const OVER_HTTPS: { readonly [name: string]: string } = { 'doh-cloudflare': 'https://cloudflare-dns.com/dns-query', 'doh-google': 'https://dns.google/dns-query' };

interface Record {
  readonly name: string;
  readonly kind: string;
  readonly ttl: number;
  readonly data: string;
}

interface Result {
  readonly kind: string;
  readonly name?: string;
  readonly code?: string;
  readonly answers?: readonly Record[];
  readonly authority?: readonly Record[];
  readonly authoritative?: boolean;
  readonly overTcp?: boolean;
  readonly ms?: number;
  readonly error?: { readonly code: string; readonly detail?: string };
}

/** What the `net_dns` command of the Rust side answers. */
type Answer = { readonly ok: true; readonly name: string; readonly server: string; readonly results: readonly Result[] } | { readonly ok: false; readonly error: { readonly code: string } };

interface Options {
  readonly kinds: readonly Kind[];
  readonly server: (typeof SERVERS)[number];
}

const readOptions = (value: unknown): Options => {
  const { kinds, server } = stored(value);
  const chosen = Array.isArray(kinds) ? KINDS.filter((kind) => kinds.includes(kind)) : [];
  return { kinds: chosen.length > 0 ? chosen : USUAL, server: oneOf(SERVERS, server) };
};

/**
 * The records a name has in the DNS: its addresses, where its mail goes,
 * its name servers, its texts, and the rest, each asked for by its kind; an
 * address gives its name (PTR). The question goes to the name server the
 * computer is set to use, or to one that is chosen, and only when asked.
 */
export default function Dns({ host, onActions }: ToolProps) {
  const { t, language } = useI18n();
  const [options, change] = useOptions(host, 'dns.options', readOptions);
  // Not kept between uses: what is typed into a tool never is.
  const [name, setName] = useState('');
  const [other, setOther] = useState('');
  const [answer, setAnswer] = useState<Extract<Answer, { ok: true }> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [told, setTold] = useState<Told | null>(null);
  const [working, setWorking] = useState(false);
  /** The name servers of the computer, to be shown beside the choice of them. */
  const [system, setSystem] = useState<readonly string[]>([]);
  const sequence = useRef(0);
  const count = (value: number) => new Intl.NumberFormat(language).format(value);

  // Read from the settings of the computer: nothing is sent anywhere by this.
  useEffect(() => {
    host.invoke<{ servers: string[] }>('net_dns_servers').then(
      (found) => setSystem(found.servers),
      () => {},
    );
  }, [host.invoke]);

  const toggle = (kind: Kind, on: boolean) => {
    const next = KINDS.filter((known) => (known === kind ? on : options.kinds.includes(known)));
    // One at least stays chosen: there is nothing to ask with none.
    if (next.length > 0) change({ kinds: next });
  };

  const run = async () => {
    const mine = ++sequence.current;
    setTold(null);
    setWorking(true);
    try {
      const server = options.server === 'system' ? undefined : options.server === 'other' ? other.trim() : (OVER_HTTPS[options.server] ?? options.server);
      const got = await host.invoke<Answer>('net_dns', { name: name.trim(), kinds: options.kinds, server, timeoutSeconds: 5 });
      if (mine !== sequence.current) return;
      setAnswer(got.ok ? got : null);
      setProblem(got.ok ? null : got.error.code);
    } catch (error) {
      if (mine === sequence.current) setTold({ key: problemKey(error), problem: true });
    } finally {
      if (mine === sequence.current) setWorking(false);
    }
  };

  const burn = () => {
    sequence.current += 1;
    if (working) void stopWork(host).catch(() => {});
    setWorking(false);
    setName('');
    setOther('');
    setAnswer(null);
    setProblem(null);
    setTold({ key: 'dev.frame.burnt' });
  };

  const copy = () => {
    if (!answer) return;
    // As zone files write records: name, how long, IN, kind, data.
    const text = answer.results.flatMap((result) => (result.answers ?? []).map((record) => `${record.name}.\t${record.ttl}\tIN\t${record.kind}\t${record.data}`)).join('\n');
    void navigator.clipboard.writeText(`${text}\n`).then(
      () => setTold({ key: 'dev.frame.copied' }),
      () => setTold({ key: 'dev.problem.clipboard', problem: true }),
    );
  };

  return (
    <AskTool
      host={host}
      onActions={onActions}
      actions={{ copy }}
      asked={
        <>
          <TextBox label={t('dev.dns.name')} value={name} hint={t('dev.dns.nameHint')} wide code onChange={setName} />
          <Choice label={t('dev.dns.server')} value={options.server} options={SERVERS.map((value) => ({ value, label: value === 'system' ? t('dev.dns.server.system') : value === 'other' ? t('dev.dns.server.other') : value in OVER_HTTPS ? t(`dev.dns.server.${value}`) : value }))} onChange={(server) => change({ server })} />
          {options.server === 'other' && <TextBox label="" value={other} hint={t('dev.dns.server.otherHint')} wide code onChange={setOther} />}
          {options.server in OVER_HTTPS && <span className={frame.optionNote} dir="ltr">{OVER_HTTPS[options.server]}</span>}
          {options.server === 'system' && <span className={frame.optionNote}>{system.length > 0 ? system.join(', ') : t('dev.dns.server.none')}</span>}
        </>
      }
      more={
        <>
          {KINDS.map((kind) => (
            <Toggle key={kind} label={kind} checked={options.kinds.includes(kind)} onChange={(on) => toggle(kind, on)} />
          ))}
          <button type="button" className={frame.action} onClick={() => change({ kinds: USUAL })}>
            {t('dev.dns.usual')}
          </button>
        </>
      }
      runLabel={t('dev.dns.run')}
      ready={!working && name.trim() !== '' && (options.server !== 'other' || other.trim() !== '')}
      onRun={() => void run()}
      working={working ? t('dev.dns.working') : null}
      counted
      told={told}
      note={t('dev.net.note')}
      onBurn={burn}
    >
      <div className={styles.answer}>
        {problem !== null && (
          <div className={frame.wrong} role="alert">
            <span className={frame.wrongTexts}>
              <span className={frame.wrongMessage}>{t(`dev.net.problem.${problem}`)}</span>
            </span>
          </div>
        )}
        {answer === null ? (
          problem === null && <div className={frame.blank}>{t('dev.dns.empty')}</div>
        ) : (
          <>
            <dl className={styles.facts}>
              <div>
                <dt>{t('dev.dns.name')}</dt>
                <dd dir="ltr">{answer.name}</dd>
              </div>
              <div>
                <dt>{t('dev.dns.asked')}</dt>
                <dd dir="ltr">{answer.server}</dd>
              </div>
            </dl>
            {answer.results.map((result) => (
              <section key={result.kind}>
                <h3 className={styles.heading}>
                  {result.kind}
                  {result.ms !== undefined && ` · ${t('dev.net.ms', { ms: count(result.ms) })}`}
                  {result.authoritative && ` · ${t('dev.dns.authoritative')}`}
                  {result.overTcp && ' · TCP'}
                </h3>
                {result.error ? (
                  <p className={styles.note} data-wrong="true">
                    {t(`dev.net.problem.${result.error.code}`)} {result.error.detail && <span dir="ltr">{result.error.detail}</span>}
                  </p>
                ) : (result.answers?.length ?? 0) === 0 ? (
                  <p className={styles.note} data-wrong={result.code !== 'NOERROR'}>
                    {t(result.code === 'NOERROR' ? 'dev.dns.none' : result.code === 'NXDOMAIN' ? 'dev.dns.noSuchName' : 'dev.dns.refused', { code: result.code ?? '' })}
                    {(result.authority?.length ?? 0) > 0 && ` ${t('dev.dns.authority', { data: result.authority?.[0]?.data ?? '' })}`}
                  </p>
                ) : (
                  <table className={`${styles.table} ${styles.records}`}>
                    <tbody>
                      {result.answers?.map((record, index) => (
                        <tr key={index}>
                          <td data-quiet="true" dir="ltr">
                            {record.name}
                          </td>
                          <td data-quiet="true">{record.kind}</td>
                          <td data-quiet="true">{t('dev.dns.ttl', { seconds: count(record.ttl) })}</td>
                          <td data-code="true" dir="ltr">
                            {record.data}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            ))}
          </>
        )}
      </div>
    </AskTool>
  );
}
