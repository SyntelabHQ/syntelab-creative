/**
 * Keys and certificates as the Rust side tells them, and how they are laid
 * out to be copied and saved: each thing once, under what it is, with the
 * name its file is usually given.
 */

/** A private key, in every form it is written in. */
export interface ToldKey {
  /** `RSA`, `ECDSA P-256`, `Ed25519`… */
  readonly kind: string;
  readonly bits: number;
  /** The forms that can be locked are locked with a passphrase. */
  readonly locked: boolean;
  /** As OpenSSH shows it: `SHA256:…`. */
  readonly fingerprint: string;
  /** The SHA-256 of its public half: the same for the key, its request and its certificate. */
  readonly digest: string;
  readonly pkcs8: string;
  /** PKCS #1 (RSA) or SEC 1 (the curves); null for Ed25519, which has no such form, and for a key that is locked. */
  readonly traditional: string | null;
  readonly openssh: string;
  readonly publicPem: string;
  readonly publicOpenssh: string;
}

export type ToldPublic = Pick<ToldKey, 'kind' | 'bits' | 'fingerprint' | 'digest' | 'publicPem' | 'publicOpenssh'>;

export interface ToldCertificate {
  readonly subject: string;
  readonly issuer: string;
  readonly selfSigned: boolean;
  /** In seconds since 1970. */
  readonly notBefore: number;
  readonly notAfter: number;
  readonly serial: string;
  readonly kind: string | null;
  readonly bits: number | null;
  readonly digest: string | null;
  /** Of the certificate itself, in hexadecimal. */
  readonly sha256: string;
  readonly pem: string;
}

export interface ToldRequest {
  readonly subject: string;
  readonly kind: string | null;
  readonly bits: number | null;
  readonly digest: string | null;
  readonly pem: string;
}

/** What a run came to: what was made, or what was read. */
export interface KeysResult {
  readonly key: ToldKey | null;
  readonly public: ToldPublic | null;
  readonly certificates: readonly ToldCertificate[];
  readonly requests: readonly ToldRequest[];
  /** The key is that of the first certificate; null when there are not both. */
  readonly matches: boolean | null;
  /** What it was read from (`pem`, `der`, `openssh`, `pkcs12`); null for what was made. */
  readonly form: string | null;
  readonly ms: number | null;
}

/** What the commands of the Rust side answer, before it is made into a result. */
export type KeysAnswer =
  | { readonly ok: true; readonly key?: ToldKey | null; readonly public?: ToldPublic | null; readonly certificate?: ToldCertificate; readonly request?: ToldRequest; readonly certificates?: readonly ToldCertificate[]; readonly requests?: readonly ToldRequest[]; readonly matches?: boolean | null; readonly form?: string; readonly ms?: number }
  | { readonly ok: false; readonly error: { readonly code: string } };

export function resultOf(answer: Extract<KeysAnswer, { ok: true }>): KeysResult {
  return {
    key: answer.key ?? null,
    public: answer.public ?? null,
    certificates: answer.certificates ?? (answer.certificate ? [answer.certificate] : []),
    requests: answer.requests ?? (answer.request ? [answer.request] : []),
    matches: answer.matches ?? null,
    form: answer.form ?? null,
    ms: answer.ms ?? null,
  };
}

/** One thing to copy or save. */
export interface Output {
  readonly id: string;
  /** A key of the translations, with what it needs. */
  readonly title: string;
  readonly values?: Readonly<Record<string, string>>;
  readonly text: string;
  /** The name its file is offered under. */
  readonly fileName: string;
  /** It can also be written as DER (it is PEM; the forms of OpenSSH are not). */
  readonly der: string | null;
  /** A private key: shown, but said to be one. */
  readonly secret: boolean;
}

/** The name OpenSSH gives the file of a key of this kind. */
export function sshName(kind: string): string {
  return kind === 'RSA' ? 'id_rsa' : kind === 'Ed25519' ? 'id_ed25519' : 'id_ecdsa';
}

/** Everything of a result that can be copied or saved, in the order it is shown. */
export function outputsOf(result: KeysResult): Output[] {
  const outputs: Output[] = [];
  const several = result.certificates.length > 1;
  result.certificates.forEach((certificate, index) => {
    const mark = several ? `-${index + 1}` : '';
    outputs.push({ id: `certificate-${index}`, title: several ? 'dev.keys.out.certificateOf' : 'dev.keys.out.certificate', values: { number: String(index + 1) }, text: certificate.pem, fileName: `certificate${mark}.pem`, der: `certificate${mark}.der`, secret: false });
  });
  result.requests.forEach((request, index) => {
    outputs.push({ id: `request-${index}`, title: 'dev.keys.out.request', text: request.pem, fileName: 'request.csr', der: 'request.der', secret: false });
  });
  const { key } = result;
  if (key) {
    outputs.push({ id: 'pkcs8', title: key.locked ? 'dev.keys.out.pkcs8Locked' : 'dev.keys.out.pkcs8', text: key.pkcs8, fileName: 'private-key.pem', der: key.locked ? null : 'private-key.der', secret: true });
    if (key.traditional !== null) outputs.push({ id: 'traditional', title: key.kind === 'RSA' ? 'dev.keys.out.pkcs1' : 'dev.keys.out.sec1', text: key.traditional, fileName: key.kind === 'RSA' ? 'private-key.rsa.pem' : 'private-key.ec.pem', der: null, secret: true });
    outputs.push({ id: 'openssh', title: key.locked ? 'dev.keys.out.opensshLocked' : 'dev.keys.out.openssh', text: key.openssh, fileName: sshName(key.kind), der: null, secret: true });
  }
  const open = key ?? result.public;
  if (open) {
    outputs.push({ id: 'publicPem', title: 'dev.keys.out.publicPem', text: open.publicPem, fileName: 'public-key.pem', der: 'public-key.der', secret: false });
    outputs.push({ id: 'publicOpenssh', title: 'dev.keys.out.publicOpenssh', text: `${open.publicOpenssh}\n`, fileName: `${sshName(open.kind)}.pub`, der: null, secret: false });
  }
  return outputs;
}

/** The text a PKCS #12 file is made from: the certificates, its own first, and the key. Null when there are not both. */
export function pkcs12Text(result: KeysResult): string | null {
  if (!result.key || result.certificates.length === 0) return null;
  return `${result.certificates.map((certificate) => certificate.pem).join('')}${result.key.pkcs8}`;
}

/** The other names a certificate is for, as they are typed: one to a line, or with commas or spaces between. */
export function namesOf(typed: string): string[] {
  return typed
    .split(/[\s,;]+/)
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

/** The kinds of key that are made, as the Rust side names them. */
export const KINDS = ['rsa', 'p256', 'p384', 'p521', 'ed25519'] as const;
export type Kind = (typeof KINDS)[number];
/** The sizes of RSA keys offered; any other is typed. */
export const RSA_SIZES = ['2048', '3072', '4096', '8192'] as const;
