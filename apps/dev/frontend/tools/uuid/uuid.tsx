import { useTranslation } from '@syntelab/i18n';
import { Choice } from '../../frame/choice';
import { GeneratorTool } from '../../frame/generator-tool';
import { NumberBox } from '../../frame/number-box';
import frame from '../../frame/tool-frame.module.css';
import { TextBox, Toggle } from '../../frame/toggle';
import { CodecTool, oneOf } from '../codec-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';
import { useState } from 'react';

/** What the tool does: makes UUIDs, or takes apart those it is given. */
const MODES = ['make', 'apart'] as const;
const VERSIONS = ['4', '7', '1', '6', '3', '5', 'nil', 'max'] as const;
/** How a UUID is written: with hyphens, without, as a URN, in braces. */
const FORMATS = ['hyphens', 'plain', 'urn', 'braces'] as const;
/** The namespaces of the standard a name is hashed in; `custom` is any UUID, typed. */
const NAMESPACES = ['dns', 'url', 'oid', 'x500', 'custom'] as const;
const INDENTS = ['2', '4', 'tab', 'min'] as const;

interface Options {
  readonly mode: (typeof MODES)[number];
  readonly version: (typeof VERSIONS)[number];
  readonly format: (typeof FORMATS)[number];
  readonly upper: boolean;
  readonly count: number;
  readonly namespace: (typeof NAMESPACES)[number];
  readonly indent: (typeof INDENTS)[number];
}

const readOptions = (value: unknown): Options => {
  const { mode, version, format, upper, count, namespace, indent } = stored(value);
  return { mode: oneOf(MODES, mode), version: oneOf(VERSIONS, version), format: oneOf(FORMATS, format), upper: upper === true, count: typeof count === 'number' && Number.isInteger(count) && count >= 1 ? count : 1, namespace: oneOf(NAMESPACES, namespace), indent: oneOf(INDENTS, indent) };
};

/**
 * UUIDs of RFC 9562 made (versions 1, 3, 4, 5, 6 and 7, nil and max), as
 * many as are asked for, written in any of their four forms; and UUIDs
 * taken apart: version, variant, and the time and node they hold. What is
 * random comes from the operating system.
 */
export default function UuidTool(props: ToolProps) {
  const t = useTranslation();
  const [options, change] = useOptions(props.host, 'uuid.options', readOptions);
  // Not kept between uses: what is typed into a tool never is.
  const [name, setName] = useState('');
  const [custom, setCustom] = useState('');
  const named = options.version === '3' || options.version === '5';
  const modes = <Choice label={t('dev.uuid.mode')} value={options.mode} options={MODES.map((value) => ({ value, label: t(`dev.uuid.mode.${value}`) }))} onChange={(mode) => change({ mode })} />;

  return (
    <>
      <div className={frame.mode} hidden={options.mode !== 'make'}>
        <GeneratorTool
          host={props.host}
          layout={props.layout}
          onActions={options.mode === 'make' ? props.onActions : NO_ACTIONS}
          tool="uuid"
          request={{ version: options.version, format: options.format, upper: options.upper, namespace: options.namespace === 'custom' ? custom : options.namespace, name }}
          count={options.count}
          bytesEach={48}
          lead={modes}
          options={
            <>
              <Choice label={t('dev.uuid.version')} value={options.version} options={VERSIONS.map((value) => ({ value, label: t(`dev.uuid.version.${value}`) }))} onChange={(version) => change({ version })} />
              {named && (
                <>
                  <Choice label={t('dev.uuid.namespace')} value={options.namespace} options={NAMESPACES.map((value) => ({ value, label: t(`dev.uuid.namespace.${value}`) }))} onChange={(namespace) => change({ namespace })} />
                  {options.namespace === 'custom' && <TextBox label={t('dev.uuid.namespace.uuid')} value={custom} code hint="6ba7b810-9dad-11d1-80b4-00c04fd430c8" onChange={setCustom} />}
                  <TextBox label={t('dev.uuid.name')} value={name} code hint="www.example.com" onChange={setName} />
                </>
              )}
              <Choice label={t('dev.uuid.format')} value={options.format} options={FORMATS.map((value) => ({ value, label: t(`dev.uuid.format.${value}`) }))} onChange={(format) => change({ format })} />
              <Toggle label={t('dev.uuid.upper')} checked={options.upper} onChange={(upper) => change({ upper })} />
              <NumberBox label={t('dev.generate.count')} value={options.count} most={Number.MAX_SAFE_INTEGER} onChange={(count) => change({ count: Math.max(count, 1) })} />
            </>
          }
          saves={{ typeName: t('dev.codec.textFiles'), extension: 'txt', name: 'uuids.txt' }}
          fine={t('dev.uuid.fine.made')}
          workTitle={t('dev.uuid.working')}
        />
      </div>
      <div className={frame.mode} hidden={options.mode !== 'apart'}>
        <CodecTool
          {...props}
          onActions={options.mode === 'apart' ? props.onActions : NO_ACTIONS}
          tool="uuid"
          options={{ indent: options.indent }}
          optionsView={
            <>
              {modes}
              <Choice label={t('dev.json.indent')} value={options.indent} options={INDENTS.map((value) => ({ value, label: t(`dev.convert.indent.${value}`) }))} onChange={(indent) => change({ indent })} />
            </>
          }
          reads
          outputSyntax="json"
          opens={{ typeName: t('dev.codec.textFiles'), extensions: ['txt', 'log', 'csv'] }}
          saves={{ typeName: t('dev.json.files'), extension: 'json', name: () => 'uuids.json' }}
          naming={{ beside: { ending: 'uuids.json' }, inFolder: { ending: 'uuids.json' }, example: 'name.uuids.json', noReplace: true }}
          fine={t('dev.uuid.fine.apart')}
          workTitle={t('dev.uuid.working')}
        />
      </div>
    </>
  );
}

/** What a part of the tool that is not shown is given in place of the tab's commands: they are the other part's. */
const NO_ACTIONS = () => {};
