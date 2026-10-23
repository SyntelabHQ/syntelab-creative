import { useI18n } from '@syntelab/i18n';
import { useRef, useState } from 'react';
import { problemKey, stopWork } from '../../api/dev-api';
import { AskTool } from '../../frame/ask-tool';
import type { Told } from '../../frame/ask-tool';
import { NumberBox } from '../../frame/number-box';
import { TextBox, Toggle } from '../../frame/toggle';
import frame from '../../frame/tool-frame.module.css';
import styles from '../network/net.module.css';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';

interface Checked {
  readonly port: number;
  readonly state: 'open' | 'closed' | 'no-answer' | 'failed';
  readonly ms: number;
}

/** What the `net_ports` command of the Rust side answers. */
type Answer =
  | { readonly ok: true; readonly address: string; readonly addresses: readonly string[]; readonly asked: number; readonly open: number; readonly closed: number; readonly noAnswer: number; readonly stopped: boolean; readonly ports: readonly Checked[] }
  | { readonly ok: false; readonly error: { readonly code: string; readonly detail?: string } };

interface Options {
  /** How long a port is waited for, in milliseconds. */
  readonly timeout: number;
  /** Only the ports that are open are listed. */
  readonly onlyOpen: boolean;
}

const readOptions = (value: unknown): Options => {
  const { timeout, onlyOpen } = stored(value);
  return { timeout: typeof timeout === 'number' && Number.isInteger(timeout) && timeout >= 50 ? timeout : 2000, onlyOpen: onlyOpen === true };
};

/** Rows are drawn so many at a time: a host has 65 535 ports. */
const DRAWN_AT_ONCE = 500;

/**
 * Whether ports of a host take connections (TCP): one port, several, or a
 * whole range. Each is tried with one connection, closed as soon as it is
 * made, many side by side; the trying shows how far it has got and can be
 * stopped. Only the host that is typed is tried, and only when asked.
 */
export default function Port({ host, onActions }: ToolProps) {
  const { t, language } = useI18n();
  const [options, change] = useOptions(host, 'port.options', readOptions);
  // Not kept between uses: what is typed into a tool never is.
  const [name, setName] = useState('');
  const [ports, setPorts] = useState('');
  const [answer, setAnswer] = useState<Extract<Answer, { ok: true }> | null>(null);
  const [problem, setProblem] = useState<{ code: string; detail?: string } | null>(null);
  const [told, setTold] = useState<Told | null>(null);
  const [working, setWorking] = useState(false);
  const [drawn, setDrawn] = useState(DRAWN_AT_ONCE);
  const sequence = useRef(0);
  const count = (value: number) => new Intl.NumberFormat(language).format(value);

  const run = async () => {
    const mine = ++sequence.current;
    setTold(null);
    setWorking(true);
    try {
      const got = await host.invoke<Answer>('net_ports', { host: name.trim(), ports, timeoutMs: options.timeout });
      if (mine !== sequence.current) return;
      setAnswer(got.ok ? got : null);
      setProblem(got.ok ? null : got.error);
      setDrawn(DRAWN_AT_ONCE);
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
    setPorts('');
    setAnswer(null);
    setProblem(null);
    setTold({ key: 'dev.frame.burnt' });
  };

  const shown = answer ? (options.onlyOpen ? answer.ports.filter((port) => port.state === 'open') : answer.ports) : [];

  /** The ports listed, one to a line with what was found, as the command Copy takes them. */
  const copy = () => {
    if (shown.length === 0) return;
    const text = shown.map((port) => `${port.port}\t${t(`dev.port.state.${port.state}`)}`).join('\n');
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
          <TextBox label={t('dev.net.host')} value={name} hint={t('dev.port.hostHint')} code onChange={setName} />
          <TextBox label={t('dev.port.ports')} value={ports} hint="22, 80, 443, 8000-8100" wide code onChange={setPorts} />
          <NumberBox label={t('dev.port.timeout')} value={options.timeout} most={600_000} onChange={(timeout) => change({ timeout: Math.max(timeout, 50) })} />
          <Toggle label={t('dev.port.onlyOpen')} checked={options.onlyOpen} onChange={(onlyOpen) => change({ onlyOpen })} />
        </>
      }
      runLabel={t('dev.port.run')}
      ready={!working && name.trim() !== '' && ports.trim() !== ''}
      onRun={() => void run()}
      working={working ? t('dev.port.working') : null}
      counted
      told={told}
      note={t('dev.net.note')}
      onBurn={burn}
    >
      <div className={styles.answer}>
        {problem !== null && (
          <div className={frame.wrong} role="alert">
            <span className={frame.wrongTexts}>
              <span className={frame.wrongMessage}>{t(`dev.net.problem.${problem.code}`)}</span>
              {problem.detail && <span dir="ltr">{problem.detail}</span>}
            </span>
          </div>
        )}
        {answer === null ? (
          problem === null && <div className={frame.blank}>{t('dev.port.empty')}</div>
        ) : (
          <>
            <dl className={styles.facts}>
              <div>
                <dt>{t('dev.net.address')}</dt>
                <dd dir="ltr">{answer.addresses.length > 1 ? t('dev.port.firstOf', { address: answer.address, others: answer.addresses.slice(1).join(', ') }) : answer.address}</dd>
              </div>
              <div>
                <dt>{t('dev.port.ports')}</dt>
                <dd>{t('dev.port.summary', { open: count(answer.open), closed: count(answer.closed), noAnswer: count(answer.noAnswer), asked: count(answer.asked) })}</dd>
              </div>
              {answer.stopped && (
                <div>
                  <dt />
                  <dd data-wrong="true">{t('dev.port.stopped', { done: count(answer.ports.length), asked: count(answer.asked) })}</dd>
                </div>
              )}
            </dl>
            {shown.length === 0 ? (
              <p className={styles.note}>{t('dev.port.noneOpen')}</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t('dev.port.port')}</th>
                    <th>{t('dev.port.state')}</th>
                    <th>{t('dev.net.time')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, drawn).map((port) => (
                    <tr key={port.port}>
                      <td data-code="true">{port.port}</td>
                      <td data-state={port.state}>{t(`dev.port.state.${port.state}`)}</td>
                      <td data-quiet="true">{t('dev.net.ms', { ms: count(port.ms) })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {shown.length > drawn && (
              <p className={styles.note}>
                <button type="button" className={frame.action} onClick={() => setDrawn(drawn + DRAWN_AT_ONCE)}>
                  {t('dev.batch.more', { count: count(shown.length - drawn) })}
                </button>
              </p>
            )}
          </>
        )}
      </div>
    </AskTool>
  );
}
