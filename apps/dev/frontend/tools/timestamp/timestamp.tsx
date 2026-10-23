import { useTranslation } from '@syntelab/i18n';
import { TextBox } from '../../frame/toggle';
import { InspectTool, readIndent } from '../inspect-tool';
import type { Indent } from '../inspect-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';

interface Options {
  /** The time zone moments are told in: a name of the IANA database, `UTC`, or empty for the one of the system. */
  readonly zone: string;
  readonly indent: Indent;
}

const readOptions = (value: unknown): Options => ({ zone: typeof stored(value).zone === 'string' ? (stored(value).zone as string) : '', indent: readIndent(stored(value).indent) });

/** The time zone of the system, as its name in the IANA database. */
export const systemZone = (): string => new Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Unix timestamps and dates told in full: each line is a count of seconds,
 * milliseconds, microseconds or nanoseconds (told apart by how large it
 * is), a date as ISO 8601 writes it, or `now`. What comes back: the counts,
 * the moment in universal time and in the zone chosen, the day of the week,
 * how far it is from now, and whether 32 bits still hold it.
 */
export default function Timestamp(props: ToolProps) {
  const t = useTranslation();
  const [options, change] = useOptions(props.host, 'timestamp.options', readOptions);

  return (
    <InspectTool
      {...props}
      tool="timestamp"
      options={{ zone: options.zone.trim() === '' ? systemZone() : options.zone.trim() }}
      optionsView={<TextBox label={t('dev.time.zone')} value={options.zone} code hint={systemZone()} onChange={(zone) => change({ zone })} />}
      indent={options.indent}
      onIndent={(indent) => change({ indent })}
      opens={{ typeName: t('dev.codec.textFiles'), extensions: ['txt', 'log', 'csv'] }}
      mark="times"
      fine={t('dev.time.fine')}
      workTitle={t('dev.time.working')}
    />
  );
}
