import { useI18n } from '@syntelab/i18n';
import { useCallback, useState } from 'react';
import { Choice } from '../../frame/choice';
import type { ToolInput, ToolOutcome } from '../../frame/text-tool';
import { TextBox } from '../../frame/toggle';
import { ToolBody } from '../../frame/tool-body';
import { oneOf } from '../codec-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';
import { REGISTERED, reportOf } from './jwt-report';

/** How the secret is written: as text, as Base64 or as hexadecimal digits. */
const FORMS = ['text', 'base64', 'hex'] as const;
type Form = (typeof FORMS)[number];

/** What the `jwt` command of the Rust side answers. */
type JwtAnswer =
  | { readonly ok: true; readonly header: string; readonly payload: string; readonly algorithm: string; readonly signature: 'valid' | 'invalid' | 'not-checked' | 'none' | 'unsupported' }
  | { readonly ok: false; readonly error: { readonly code: string } };

/**
 * A JSON Web Token taken apart: its header and its payload as JSON, its
 * claims in words (the moments in time as dates), and its signature checked
 * against a secret when it was made with one (HS256, HS384, HS512). The
 * token is only read: nothing is fetched, and nothing is trusted.
 *
 * The secret is typed into the tool and stays in memory: it is not one of
 * the options that are kept. Only how it is written is.
 */
export default function Jwt({ host, layout, onActions }: ToolProps) {
  const { t } = useI18n();
  const [options, change] = useOptions(host, 'jwt.options', (value): { readonly form: Form } => ({ form: oneOf(FORMS, stored(value).form) }));
  const [secret, setSecret] = useState('');

  const { form } = options;
  const run = useCallback(
    async (input: ToolInput): Promise<ToolOutcome> => {
      // A token is short, and is read as a text: a file that was opened came into the editor.
      const token = 'text' in input ? input.text : '';
      const answer = await host.invoke<JwtAnswer>('jwt', { token, secret, secretForm: form });
      if (!answer.ok) return { ok: false, message: t(`dev.jwt.problem.${answer.error.code}`), line: 0, column: 0, offset: 0 };
      const text = reportOf(answer.header, answer.payload, {
        header: t('dev.jwt.header'),
        payload: t('dev.jwt.payload'),
        claims: t('dev.jwt.claims'),
        claim: (name) => ((REGISTERED as readonly string[]).includes(name) ? t(`dev.jwt.claim.${name}`) : name),
        when: (name, past) => t(`dev.jwt.when.${name}.${past ? 'past' : 'coming'}`),
      });
      const signature = t(`dev.jwt.signature.${answer.signature}`, { algorithm: answer.algorithm || '?' });
      return { ok: true, text, fine: t('dev.jwt.read'), summary: signature, warning: answer.signature === 'invalid' };
    },
    [host.invoke, secret, form, t],
  );

  return (
    <ToolBody
      host={host}
      layout={layout}
      options={
        <>
          <TextBox label={t('dev.jwt.secret')} value={secret} hidden hint={t('dev.jwt.secretHint')} onChange={setSecret} />
          <Choice label={t('dev.jwt.secretForm')} value={form} options={FORMS.map((value) => ({ value, label: t(`dev.jwt.secretForm.${value}`) }))} onChange={(value) => change({ form: value })} />
        </>
      }
      optionsKey={`${form}:${secret}`}
      tellsOnly={false}
      run={run}
      opens={{ typeName: t('dev.codec.textFiles'), extensions: ['txt', 'jwt', 'token'] }}
      saves={{ typeName: t('dev.codec.textFiles'), extension: 'txt', name: () => 'token.txt' }}
      workTitle={t('dev.jwt.working')}
      onActions={onActions}
    />
  );
}
