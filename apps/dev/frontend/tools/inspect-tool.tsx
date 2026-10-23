import { useTranslation } from '@syntelab/i18n';
import type { ReactNode } from 'react';
import { Choice } from '../frame/choice';
import { CodecTool, oneOf } from './codec-tool';
import type { CodecToolProps } from './codec-tool';
import type { ToolProps } from './registry';

/** How the JSON a tool tells in is written: pushed in by spaces or a tab, or on one line. */
export const INDENTS = ['2', '4', 'tab', 'min'] as const;
export type Indent = (typeof INDENTS)[number];
export const readIndent = (value: unknown): Indent => oneOf(INDENTS, value);

export interface InspectToolProps extends ToolProps {
  /** The tool as the Rust side knows it (its id in the catalog). */
  readonly tool: string;
  /** Its options beside the indent, as the Rust side takes them. */
  readonly options?: Readonly<Record<string, unknown>>;
  /** Those options as the user chooses them, drawn before the indent. */
  readonly optionsView?: ReactNode;
  readonly indent: Indent;
  readonly onIndent: (indent: Indent) => void;
  /** Told the JSON of each result, to be laid out; and the view it is laid out in. */
  readonly onText?: CodecToolProps['onText'];
  readonly extra?: CodecToolProps['extra'];
  readonly below?: CodecToolProps['below'];
  readonly put?: CodecToolProps['put'];
  /** What it tells is short whatever is given: that of a file is shown, and not asked a file to go to. */
  readonly resultFits?: boolean;
  /** The tool takes any bytes, not only text (a certificate in DER). */
  readonly takesBytes?: boolean;
  readonly opens: { readonly typeName: string; readonly extensions: readonly string[] };
  /** What the files of results are called after their own: `name.<mark>.json`. */
  readonly mark: string;
  /** That all was read, in a few words, already translated. */
  readonly fine: string;
  readonly workTitle: string;
}

/**
 * A tool that tells what something is made of (a moment, a schedule, a URL,
 * a certificate): what is given is read by the Rust side, and what it says
 * comes back as JSON, coloured as such. What is not what the tool reads is
 * told the moment it is given.
 */
export function InspectTool({ tool, options, optionsView, indent, onIndent, onText, extra, below, put, resultFits, takesBytes, opens, mark, fine, workTitle, ...props }: InspectToolProps) {
  const t = useTranslation();
  const ending = `${mark}.json`;

  return (
    <CodecTool
      {...props}
      tool={tool}
      options={{ ...options, indent }}
      optionsView={
        <>
          {optionsView}
          <Choice label={t('dev.json.indent')} value={indent} options={INDENTS.map((value) => ({ value, label: t(`dev.convert.indent.${value}`) }))} onChange={onIndent} />
        </>
      }
      reads
      onText={onText}
      extra={extra}
      below={below}
      put={put}
      takesBytes={takesBytes}
      resultFits={resultFits}
      outputSyntax="json"
      opens={opens}
      saves={{ typeName: t('dev.json.files'), extension: 'json', name: (name) => `${name?.replace(/\.[^.]+$/, '') ?? mark}.${ending}` }}
      naming={{ beside: { ending }, inFolder: { ending }, example: `name.${ending}`, noReplace: true }}
      fine={fine}
      workTitle={workTitle}
    />
  );
}
