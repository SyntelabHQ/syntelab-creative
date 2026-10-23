import { useTranslation } from '@syntelab/i18n';
import { useState } from 'react';
import { Choice } from '../../frame/choice';
import { TextBox, Toggle } from '../../frame/toggle';
import { CodecTool, oneOf } from '../codec-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';

const ALGORITHMS = ['sha256', 'sha512', 'sha384', 'sha1', 'md5', 'crc32'] as const;
type Algorithm = (typeof ALGORITHMS)[number];
const NAMES: Readonly<Record<Algorithm, string>> = { sha256: 'SHA-256', sha512: 'SHA-512', sha384: 'SHA-384', sha1: 'SHA-1', md5: 'MD5', crc32: 'CRC-32' };
/** How a digest is written. */
const FORMS = ['hex', 'upper', 'base64'] as const;
/** How the key of an HMAC is given. */
const KEY_FORMS = ['text', 'hex', 'base64'] as const;

interface Options {
  readonly algorithms: readonly Algorithm[];
  readonly form: (typeof FORMS)[number];
  readonly keyForm: (typeof KEY_FORMS)[number];
  /** Each line of what is given is hashed apart. */
  readonly lines: boolean;
}

const readOptions = (value: unknown): Options => {
  const { algorithms, form, keyForm, lines } = stored(value);
  const chosen = Array.isArray(algorithms) ? ALGORITHMS.filter((algorithm) => algorithms.includes(algorithm)) : [];
  return { algorithms: chosen.length > 0 ? chosen : ['sha256'], form: oneOf(FORMS, form), keyForm: oneOf(KEY_FORMS, keyForm), lines: lines === true };
};

/**
 * The digests of a text or a file: CRC-32, MD5, SHA-1, SHA-256, SHA-384,
 * SHA-512, as many of them as are chosen in one reading; HMAC when a key is
 * given; each line apart when asked. A digest that came with a file is
 * pasted beside, and told to match or not. A file of any size is hashed as
 * it is read. The key and the digest to check are not kept between uses.
 */
export default function Hash(props: ToolProps) {
  const t = useTranslation();
  const [options, change] = useOptions(props.host, 'hash.options', readOptions);
  // Not kept between uses: what is typed into a tool never is.
  const [key, setKey] = useState('');
  const [expected, setExpected] = useState('');
  const keyed = key !== '';
  // CRC-32 has no keyed form: while a key is typed it is shown off, and SHA-256 stands in when it was the only one chosen.
  const withoutCrc = options.algorithms.filter((algorithm) => algorithm !== 'crc32');
  const algorithms: readonly Algorithm[] = !keyed ? options.algorithms : withoutCrc.length > 0 ? withoutCrc : ['sha256'];
  const toggle = (algorithm: Algorithm, on: boolean) => {
    const next = ALGORITHMS.filter((known) => (known === algorithm ? on : algorithms.includes(known) || (known === 'crc32' && options.algorithms.includes(known))));
    // One at least stays chosen: there is nothing to make of none.
    if (next.some((known) => !keyed || known !== 'crc32')) change({ algorithms: next });
  };
  const ending = algorithms.length === 1 ? (algorithms[0] ?? 'sha256') : 'hashes';

  return (
    <CodecTool
      {...props}
      tool="hash"
      options={{ algorithms, form: options.form, lines: options.lines, key, keyForm: options.keyForm, expected: options.lines ? '' : expected }}
      optionsView={
        <>
          {ALGORITHMS.map((algorithm) => (
            <Toggle key={algorithm} label={NAMES[algorithm]} checked={algorithms.includes(algorithm)} disabled={algorithm === 'crc32' && keyed} onChange={(on) => toggle(algorithm, on)} />
          ))}
          <Choice label={t('dev.hash.form')} value={options.form} options={FORMS.map((value) => ({ value, label: t(`dev.hash.form.${value}`) }))} onChange={(form) => change({ form })} />
          <Toggle label={t('dev.hash.lines')} checked={options.lines} onChange={(lines) => change({ lines })} />
          <TextBox label={t('dev.hash.key')} value={key} hidden code hint={t('dev.hash.keyHint')} onChange={setKey} />
          <Choice label={t('dev.hash.keyForm')} value={options.keyForm} disabled={key === ''} options={KEY_FORMS.map((value) => ({ value, label: t(`dev.hash.keyForm.${value}`) }))} onChange={(keyForm) => change({ keyForm })} />
          {!options.lines && <TextBox label={t('dev.hash.expected')} value={expected} wide code hint={t('dev.hash.expectedHint')} onChange={setExpected} />}
        </>
      }
      reads={false}
      takesBytes
      resultFits
      warnsOn="hash-no-match"
      opens={{ typeName: t('dev.codec.anyFile'), extensions: ['*'] }}
      saves={{ typeName: t('dev.codec.textFiles'), extension: ending, name: (name) => `${name ?? 'text'}.${ending}` }}
      naming={{ beside: { append: ending }, inFolder: { append: ending }, example: `name.ext.${ending}`, noReplace: true }}
      fine={t(keyed ? 'dev.hash.fine.keyed' : 'dev.hash.fine')}
      workTitle={t('dev.hash.working')}
    />
  );
}
