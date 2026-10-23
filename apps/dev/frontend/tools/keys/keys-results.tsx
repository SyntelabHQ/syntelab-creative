import { useI18n } from '@syntelab/i18n';
import { Icon } from '@syntelab/ui-kit';
import { useState } from 'react';
import { TextBox, Toggle } from '../../frame/toggle';
import frame from '../../frame/tool-frame.module.css';
import { outputsOf, pkcs12Text } from './keys-told';
import type { KeysResult } from './keys-told';
import styles from './keys.module.css';

/** Something said in the line under the tool: a key of the translations, with what it needs. */
export interface Told {
  readonly key: string;
  readonly values?: Readonly<Record<string, string>>;
  readonly problem?: boolean;
}

export interface KeysResultsProps {
  readonly result: KeysResult;
  /** How long the making took, already written; null for what was read. */
  readonly took: string | null;
  /** A text is to be written to a file the user chooses, offered under this name. */
  readonly onSave: (text: string, name: string) => void;
  /** A text is to be written as bytes: DER, or a PKCS #12 file. */
  readonly onWrite: (form: 'der' | 'pkcs12', text: string, name: string, more?: Readonly<Record<string, unknown>>) => void;
  readonly onTold: (told: Told) => void;
}

/**
 * What was made or read, laid out to be used: what each thing is (the kind
 * of a key and its fingerprint; whom a certificate is for and how long it
 * holds; whether a key and a certificate belong together), then each of
 * them in every form, to copy or to save. A key and its certificate can be
 * put together in a PKCS #12 file.
 */
export function KeysResults({ result, took, onSave, onWrite, onTold }: KeysResultsProps) {
  const { t, language } = useI18n();
  // Not kept: what locks a file is typed each time.
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [compatible, setCompatible] = useState(false);
  const outputs = outputsOf(result);
  const together = pkcs12Text(result);
  const open = result.key ?? result.public;
  const day = (seconds: number) => new Intl.DateTimeFormat(language, { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(seconds * 1000));
  const now = Date.now() / 1000;

  const copy = (text: string) =>
    void navigator.clipboard.writeText(text).then(
      () => onTold({ key: 'dev.frame.copied' }),
      () => onTold({ key: 'dev.problem.clipboard', problem: true }),
    );

  return (
    <div className={styles.told}>
      <div className={frame.fine} role="status">
        <Icon name="circle-check" size={15} />
        <span className={frame.wrongTexts}>
          <span className={frame.wrongMessage}>{t(result.form === null ? 'dev.keys.made' : `dev.keys.readFrom.${result.form}`)}</span>
          {took !== null && <span>{took}</span>}
        </span>
      </div>
      {result.matches !== null && (
        <div className={result.matches ? frame.fine : frame.wrong} role="status">
          <Icon name={result.matches ? 'circle-check' : 'triangle-exclamation'} size={15} />
          <span className={frame.wrongTexts}>
            <span className={frame.wrongMessage}>{t(result.matches ? 'dev.keys.matches' : 'dev.keys.matchesNot')}</span>
          </span>
        </div>
      )}

      {open && (
        <dl className={styles.facts}>
          <div>
            <dt>{t(result.key ? 'dev.keys.fact.key' : 'dev.keys.fact.public')}</dt>
            <dd>{t('dev.keys.fact.kind', { kind: open.kind, bits: String(open.bits) })}</dd>
          </div>
          <div>
            <dt>{t('dev.keys.fact.fingerprint')}</dt>
            <dd dir="ltr">{open.fingerprint}</dd>
          </div>
        </dl>
      )}
      {result.certificates.map((certificate, index) => (
        <dl key={certificate.sha256} className={styles.facts}>
          <div>
            <dt>{result.certificates.length > 1 ? t('dev.keys.out.certificateOf', { number: String(index + 1) }) : t('dev.keys.out.certificate')}</dt>
            <dd dir="ltr">{certificate.subject}</dd>
          </div>
          <div>
            <dt>{t('dev.keys.fact.issuer')}</dt>
            <dd dir="ltr">{certificate.selfSigned ? t('dev.keys.fact.selfSigned') : certificate.issuer}</dd>
          </div>
          <div>
            <dt>{t('dev.keys.fact.holds')}</dt>
            <dd data-wrong={certificate.notAfter < now || certificate.notBefore > now}>
              {day(certificate.notBefore)} – {day(certificate.notAfter)} (UTC){certificate.notAfter < now ? ` · ${t('dev.keys.fact.expired')}` : ''}
            </dd>
          </div>
          {certificate.kind !== null && (
            <div>
              <dt>{t('dev.keys.fact.public')}</dt>
              <dd>{t('dev.keys.fact.kind', { kind: certificate.kind, bits: String(certificate.bits ?? 0) })}</dd>
            </div>
          )}
          <div>
            <dt>SHA-256</dt>
            <dd dir="ltr">{certificate.sha256}</dd>
          </div>
        </dl>
      ))}
      {result.requests.map((request) => (
        <dl key={request.pem} className={styles.facts}>
          <div>
            <dt>{t('dev.keys.out.request')}</dt>
            <dd dir="ltr">{request.subject === '' ? '–' : request.subject}</dd>
          </div>
          {request.kind !== null && (
            <div>
              <dt>{t('dev.keys.fact.public')}</dt>
              <dd>{t('dev.keys.fact.kind', { kind: request.kind, bits: String(request.bits ?? 0) })}</dd>
            </div>
          )}
        </dl>
      ))}

      {together !== null && (
        <div className={styles.together}>
          <span className={styles.heading}>{t('dev.keys.pkcs12')}</span>
          <TextBox label={t('dev.keys.pkcs12.password')} value={password} hidden onChange={setPassword} />
          <TextBox label={t('dev.keys.pkcs12.name')} value={name} hint={t('dev.keys.pkcs12.nameHint')} onChange={setName} />
          <Toggle label={t('dev.keys.pkcs12.compatible')} checked={compatible} onChange={setCompatible} />
          <button type="button" className={frame.action} disabled={password === ''} onClick={() => onWrite('pkcs12', together, 'certificate.pfx', { password, name, compatible })}>
            <Icon name="floppy-disk" size={13} />
            {t('dev.keys.pkcs12.save')}
          </button>
          {password === '' && <span className={styles.hint}>{t('dev.keys.pkcs12.needsPassword')}</span>}
        </div>
      )}

      {outputs.map((output) => (
        <article key={output.id} className={styles.output}>
          <div className={frame.paneHead}>
            <span className={frame.paneTitle}>{t(output.title, output.values)}</span>
            {output.secret && <span className={styles.secret}>{t('dev.keys.secret')}</span>}
            <span className={frame.spring} />
            <button type="button" className={frame.action} onClick={() => copy(output.text)}>
              <Icon name="copy" size={13} />
              {t('dev.frame.copy')}
            </button>
            <button type="button" className={frame.action} onClick={() => onSave(output.text, output.fileName)}>
              <Icon name="floppy-disk" size={13} />
              {t('dev.frame.saveFile')}
            </button>
            {output.der !== null && (
              <button type="button" className={frame.action} onClick={() => onWrite('der', output.text, output.der ?? '')}>
                <Icon name="file-export" size={13} />
                {t('dev.keys.saveDer')}
              </button>
            )}
          </div>
          <pre className={styles.text} dir="ltr">
            {output.text}
          </pre>
        </article>
      ))}
    </div>
  );
}
