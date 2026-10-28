import { useI18n } from '@syntelab/i18n';
import { AppInvokeError, fileName } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';
import { Button, Icon, tooltip } from '@syntelab/ui-kit';
import { useEffect, useMemo, useState } from 'react';
import { loadSettings, saveSettings } from '../settings/organizer-settings';
import shapeStyles from '../organize/shape-dialog.module.css';
import styles from './signing.module.css';

/** A certificate that can sign, as `list_certificates` and `certificate_of_file` describe it. */
export interface Certificate {
  readonly id: string;
  readonly subject: string;
  readonly issuer: string;
  /** Seconds since 1970. */
  readonly validFrom: number;
  readonly validUntil: number;
}

/** The certificate to sign with: one of the computer's, or one in a file opened with its password. */
export type ChosenCertificate = { readonly id: string } | { readonly path: string; readonly password: string };

/** The certificate the user settled on, and who it belongs to. */
export interface SigningCertificate {
  readonly certificate: ChosenCertificate;
  /** Written where the signature shows. */
  readonly signer: string;
}

const FILE = 'file';
/** How a certificate file is named among the favorites: by its path. */
const FILE_FAVORITE = 'file:';

/** Which certificate signs: what the user has chosen so far, and what the choosing needs. */
export interface CertificateChoice {
  /** Those of the computer (a card or a token shows among them); null while they are looked for. */
  readonly certificates: readonly Certificate[] | null;
  /** The id of one of them, `file`, or empty while none is chosen. */
  readonly chosen: string;
  readonly choose: (chosen: string) => void;
  readonly file: string;
  readonly chooseFile: () => Promise<void>;
  readonly password: string;
  readonly setPassword: (password: string) => void;
  /** Who the chosen certificate of the computer belongs to; null for a file, whose owner is known once it is opened. */
  readonly signer: string | null;
  /** Something is chosen that can be tried. */
  readonly ready: boolean;
  readonly checking: boolean;
  /** Why the last try failed, as a key of the translations. */
  readonly problem: string | null;
  /** Settles the choice; a file is opened with its password first. Null when that fails (`problem` says why). */
  readonly settle: () => Promise<SigningCertificate | null>;
  /** The certificates marked as favorites: ids of the computer's, or `file:` and a path. */
  readonly favorites: readonly string[];
  /** Marks one of the computer's certificates (by its id), or the certificate file chosen (`file`), as a favorite or not. */
  readonly toggleFavorite: (chosen: string) => void;
}

/** The choosing of a certificate, started anew each time `active` becomes true. */
export function useCertificateChoice(host: Pick<AppHost, 'invoke' | 'pickFiles' | 'loadData' | 'saveData'>, active: boolean): CertificateChoice {
  const { t } = useI18n();
  const { invoke, pickFiles } = host;
  const [certificates, setCertificates] = useState<readonly Certificate[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [file, setFile] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [favorites, setFavorites] = useState<readonly string[]>(() => loadSettings(host).favoriteCertificates);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setProblem(null);
    // A password is asked for each time: it is kept nowhere.
    setPassword('');
    setCertificates(null);
    const marked = loadSettings(host).favoriteCertificates;
    setFavorites(marked);
    invoke<{ certificates: Certificate[] }>('list_certificates', {})
      .then((answer) => {
        if (cancelled) return;
        setCertificates(answer.certificates);
        const now = Date.now() / 1000;
        const usable = (id: string) => answer.certificates.some((certificate) => certificate.id === id && certificate.validUntil > now);
        // The first favorite that can sign is chosen, before any other: one of the computer's, or a file.
        const favorite = marked.find((entry) => entry.startsWith(FILE_FAVORITE) || usable(entry));
        if (favorite?.startsWith(FILE_FAVORITE)) setFile((current) => current || favorite.slice(FILE_FAVORITE.length));
        const first = answer.certificates.find((certificate) => certificate.validUntil > now);
        setChosen((current) => {
          if (current === FILE || answer.certificates.some((certificate) => certificate.id === current)) return current;
          if (favorite) return favorite.startsWith(FILE_FAVORITE) ? FILE : favorite;
          return first?.id ?? FILE;
        });
      })
      .catch(() => !cancelled && setCertificates([]));
    return () => {
      cancelled = true;
    };
    // The favorites are read when the choosing starts, not at every change of the host.
  }, [active, invoke]);

  const toggleFavorite = (which: string) => {
    const entry = which === FILE ? `${FILE_FAVORITE}${file}` : which;
    if (entry === FILE_FAVORITE) return;
    const next = favorites.includes(entry) ? favorites.filter((known) => known !== entry) : [...favorites, entry];
    setFavorites(next);
    saveSettings(host, { ...loadSettings(host), favoriteCertificates: next });
  };

  const storeCertificate = certificates?.find((known) => known.id === chosen);

  const chooseFile = async () => {
    const [picked] = await pickFiles({ typeName: t('pdf-organizer.sign.fileType'), extensions: ['pfx', 'p12'] });
    if (!picked) return;
    setFile(picked);
    setChosen(FILE);
    setProblem(null);
  };

  const settle = async (): Promise<SigningCertificate | null> => {
    setProblem(null);
    if (chosen !== FILE) return storeCertificate ? { certificate: { id: storeCertificate.id }, signer: storeCertificate.subject } : null;
    // The password is tried before anything else happens.
    setChecking(true);
    try {
      const certificate = await invoke<Certificate>('certificate_of_file', { path: file, password });
      return { certificate: { path: file, password }, signer: certificate.subject };
    } catch (error) {
      const code = error instanceof AppInvokeError ? error.code : '';
      setProblem(code === 'wrong-password' ? 'pdf-organizer.sign.wrongPassword' : code === 'certificates-unsupported' ? 'pdf-organizer.sign.unsupported' : 'pdf-organizer.sign.noCertificateInFile');
      return null;
    } finally {
      setChecking(false);
    }
  };

  return {
    certificates,
    chosen,
    choose: setChosen,
    file,
    chooseFile,
    password,
    setPassword,
    signer: storeCertificate?.subject ?? null,
    ready: chosen === FILE ? file !== '' : chosen !== '',
    checking,
    problem,
    settle,
    favorites,
    toggleFavorite,
  };
}

export interface CertificatePickerProps {
  readonly choice: CertificateChoice;
  readonly disabled?: boolean;
}

/** The certificates to sign with: those of the computer, one to a row, and one in a file with its password. */
export function CertificatePicker({ choice, disabled = false }: CertificatePickerProps) {
  const { t, language } = useI18n();
  const { certificates, chosen, choose, file, password, favorites, toggleFavorite } = choice;
  const now = Date.now() / 1000;
  const day = useMemo(() => new Intl.DateTimeFormat(language, { dateStyle: 'medium' }), [language]);
  // Favorites first, in the order they were marked; the rest as the computer lists them.
  const rank = (certificate: Certificate) => {
    const place = favorites.indexOf(certificate.id);
    return place < 0 ? favorites.length : place;
  };
  const listed = certificates ? [...certificates].sort((first, second) => rank(first) - rank(second)) : null;
  const star = (which: string, marked: boolean) => (
    <button
      type="button"
      className={styles.favorite}
      data-marked={marked}
      aria-pressed={marked}
      aria-label={t(marked ? 'pdf-organizer.sign.unfavorite' : 'pdf-organizer.sign.favorite')}
      disabled={disabled}
      {...tooltip(t(marked ? 'pdf-organizer.sign.unfavorite' : 'pdf-organizer.sign.favorite'), 'start')}
      onClick={() => toggleFavorite(which)}
    >
      <Icon name={marked ? 'star' : 'star-regular'} size={15} />
    </button>
  );

  return (
    <section className={shapeStyles.field}>
      <h3 className={shapeStyles.legend}>{t('pdf-organizer.sign.certificates')}</h3>
      {certificates === null && <p className={shapeStyles.lead}>{t('pdf-organizer.sign.looking')}</p>}
      {certificates?.length === 0 && <p className={shapeStyles.lead}>{t('pdf-organizer.sign.none')}</p>}
      {listed && listed.length > 0 && (
        <ul className={styles.certificates}>
          {listed.map((certificate) => {
            const expired = certificate.validUntil <= now;
            return (
              <li key={certificate.id} className={styles.row}>
                <label className={styles.certificate} data-chosen={chosen === certificate.id} data-expired={expired}>
                  <input type="radio" checked={chosen === certificate.id} disabled={expired || disabled} onChange={() => choose(certificate.id)} />
                  <span className={styles.facts}>
                    <bdi className={styles.name}>{certificate.subject}</bdi>
                    <span className={styles.detail}>{t('pdf-organizer.sign.issuedBy', { issuer: certificate.issuer })}</span>
                    <span className={styles.detail}>{t(expired ? 'pdf-organizer.sign.expiredOn' : 'pdf-organizer.sign.validUntil', { date: day.format(new Date(certificate.validUntil * 1000)) })}</span>
                  </span>
                </label>
                {star(certificate.id, favorites.includes(certificate.id))}
              </li>
            );
          })}
        </ul>
      )}
      <div className={styles.row}>
      <label className={styles.certificate} data-chosen={chosen === FILE}>
        <input type="radio" checked={chosen === FILE} disabled={disabled} onChange={() => choose(FILE)} />
        <span className={styles.facts}>
          <span className={styles.name}>{t('pdf-organizer.sign.fromFile')}</span>
          <span className={styles.fileRow}>
            <Button disabled={disabled} onClick={() => void choice.chooseFile()}>
              <Icon name="folder-open" size={14} />
              {t('pdf-organizer.sign.chooseFile')}
            </Button>
            {file !== '' && (
              <bdi className={styles.detail} dir="ltr">
                {fileName(file)}
              </bdi>
            )}
          </span>
          {chosen === FILE && file !== '' && (
            <input
              type="password"
              className={styles.field}
              autoComplete="off"
              value={password}
              disabled={disabled}
              placeholder={t('pdf-organizer.sign.password')}
              aria-label={t('pdf-organizer.sign.password')}
              onChange={(event) => choice.setPassword(event.target.value)}
            />
          )}
        </span>
      </label>
      {file !== '' && star(FILE, favorites.includes(`${FILE_FAVORITE}${file}`))}
      </div>
      {choice.problem && (
        <p className={styles.problem} role="alert">
          {t(choice.problem)}
        </p>
      )}
    </section>
  );
}
