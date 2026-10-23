import { useTranslation } from '@syntelab/i18n';
import { Choice } from '../../frame/choice';
import { TextBox, Toggle } from '../../frame/toggle';
import { oneOf } from '../codec-tool';
import { DeriveTool } from '../derive-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';

/** How an object is declared: `interface Name { … }` or `type Name = { … }`. */
const KINDS = ['interface', 'type'] as const;

interface Options {
  readonly kind: (typeof KINDS)[number];
  readonly exported: boolean;
  readonly readonly: boolean;
  /** The name of the type of the whole document. A name, not something typed into the tool: it is kept. */
  readonly root: string;
}

function readOptions(value: unknown): Options {
  const { kind, exported, readonly, root } = stored(value);
  return { kind: oneOf(KINDS, kind), exported: exported !== false, readonly: readonly === true, root: typeof root === 'string' && root.trim() !== '' ? root : 'Root' };
}

/**
 * TypeScript declarations written from a sample of JSON: one for the whole
 * document and one for each object inside it, named after the key it stands
 * under. The items of an array are merged into one shape, with the keys
 * some of them lack marked optional.
 */
export default function JsonToTypeScript(props: ToolProps) {
  const t = useTranslation();
  const [options, change] = useOptions(props.host, 'json-to-typescript.options', readOptions);

  return (
    <DeriveTool
      {...props}
      what="typescript"
      options={{ root: options.root, interfaces: options.kind === 'interface', exported: options.exported, readonly: options.readonly }}
      optionsView={
        <>
          <TextBox label={t('dev.typescript.root')} value={options.root} code onChange={(root) => change({ root })} />
          <Choice label={t('dev.typescript.kind')} value={options.kind} options={KINDS.map((value) => ({ value, label: value }))} onChange={(kind) => change({ kind })} />
          <Toggle label="export" checked={options.exported} onChange={(exported) => change({ exported })} />
          <Toggle label="readonly" checked={options.readonly} onChange={(readonly) => change({ readonly })} />
        </>
      }
      saves={{ typeName: t('dev.typescript.files'), extension: 'ts', name: (name) => `${name?.replace(/\.[^.]+$/, '') ?? 'types'}.d.ts` }}
      fine={t('dev.typescript.fine')}
      workTitle={t('dev.typescript.working')}
    />
  );
}
