import { describe, expect, it } from 'vitest';
import { namesOf, outputsOf, pkcs12Text, resultOf, sshName } from './keys-told';
import type { ToldCertificate, ToldKey } from './keys-told';

const key = (over: Partial<ToldKey> = {}): ToldKey => ({ kind: 'RSA', bits: 2048, locked: false, fingerprint: 'SHA256:x', digest: 'ab', pkcs8: 'PKCS8\n', traditional: 'PKCS1\n', openssh: 'OPENSSH\n', publicPem: 'PUBLIC\n', publicOpenssh: 'ssh-rsa AAAA me', ...over });
const certificate = (pem: string): ToldCertificate => ({ subject: 'CN=x', issuer: 'CN=x', selfSigned: true, notBefore: 0, notAfter: 1, serial: '01', kind: 'RSA', bits: 2048, digest: 'ab', sha256: 'cd', pem });

describe('what a result gives to copy and save', () => {
  it('lists a key in every form, its public half after', () => {
    const outputs = outputsOf(resultOf({ ok: true, key: key() }));
    expect(outputs.map((output) => output.id)).toEqual(['pkcs8', 'traditional', 'openssh', 'publicPem', 'publicOpenssh']);
    expect(outputs.map((output) => output.fileName)).toEqual(['private-key.pem', 'private-key.rsa.pem', 'id_rsa', 'public-key.pem', 'id_rsa.pub']);
    expect(outputs.filter((output) => output.secret).map((output) => output.id)).toEqual(['pkcs8', 'traditional', 'openssh']);
    expect(outputs.find((output) => output.id === 'publicOpenssh')?.text).toBe('ssh-rsa AAAA me\n');
  });

  it('leaves out the form a key does not have, and does not offer a locked key as DER', () => {
    const outputs = outputsOf(resultOf({ ok: true, key: key({ kind: 'Ed25519', traditional: null, locked: true }) }));
    expect(outputs.map((output) => output.id)).toEqual(['pkcs8', 'openssh', 'publicPem', 'publicOpenssh']);
    expect(outputs[0]).toMatchObject({ title: 'dev.keys.out.pkcs8Locked', der: null });
    expect(outputs[1]?.fileName).toBe('id_ed25519');
  });

  it('puts the certificate and the request before the key', () => {
    const made = outputsOf(resultOf({ ok: true, key: key(), certificate: certificate('CERT\n') }));
    expect(made[0]).toMatchObject({ id: 'certificate-0', fileName: 'certificate.pem', der: 'certificate.der' });
    const chain = outputsOf(resultOf({ ok: true, certificates: [certificate('A\n'), certificate('B\n')] }));
    expect(chain.map((output) => output.fileName)).toEqual(['certificate-1.pem', 'certificate-2.pem']);
    expect(chain[1]?.values).toEqual({ number: '2' });
  });

  it('lists a public key given by itself', () => {
    const { kind, bits, fingerprint, digest, publicPem, publicOpenssh } = key({ kind: 'ECDSA P-256' });
    const outputs = outputsOf(resultOf({ ok: true, public: { kind, bits, fingerprint, digest, publicPem, publicOpenssh } }));
    expect(outputs.map((output) => output.fileName)).toEqual(['public-key.pem', 'id_ecdsa.pub']);
  });
});

describe('what a PKCS #12 file is made from', () => {
  it('is the certificates and the key, and nothing when one is missing', () => {
    expect(pkcs12Text(resultOf({ ok: true, key: key(), certificates: [certificate('A\n'), certificate('B\n')] }))).toBe('A\nB\nPKCS8\n');
    expect(pkcs12Text(resultOf({ ok: true, key: key() }))).toBeNull();
    expect(pkcs12Text(resultOf({ ok: true, certificate: certificate('A\n') }))).toBeNull();
  });
});

describe('names as they are typed', () => {
  it('are told apart by lines, commas and spaces', () => {
    expect(namesOf('example.test, *.example.test\n10.0.0.1;  ::1\n\n')).toEqual(['example.test', '*.example.test', '10.0.0.1', '::1']);
    expect(namesOf('  ')).toEqual([]);
  });
});

describe('the name OpenSSH gives a key file', () => {
  it('goes by the kind of key', () => {
    expect([sshName('RSA'), sshName('Ed25519'), sshName('ECDSA P-384')]).toEqual(['id_rsa', 'id_ed25519', 'id_ecdsa']);
  });
});
