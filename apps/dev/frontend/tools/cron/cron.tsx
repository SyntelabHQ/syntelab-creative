import { useTranslation } from '@syntelab/i18n';
import { useCallback, useState } from 'react';
import { Choice } from '../../frame/choice';
import type { TextToPut } from '../../frame/text-tool';
import { TextBox, Toggle } from '../../frame/toggle';
import { oneOf } from '../codec-tool';
import { InspectTool, readIndent } from '../inspect-tool';
import type { Indent } from '../inspect-tool';
import type { ToolProps } from '../registry';
import { systemZone } from '../timestamp/timestamp';
import { stored, useOptions } from '../use-options';
import type { Built } from './cron-build';
import { CronBuilder } from './cron-builder';
import { CronView } from './cron-view';
import type { CronTold } from './cron-words';

/** How many runs are listed, after now and before it. */
const COUNTS = ['5', '10', '25', '100'] as const;
/** How the days of the week of a cron schedule are numbered: 0 is Sunday (crontab and most others), or 1 is Sunday (Quartz). */
const NUMBERINGS = ['unix', 'quartz'] as const;

interface Options {
  readonly zone: string;
  readonly count: (typeof COUNTS)[number];
  readonly numbering: (typeof NUMBERINGS)[number];
  /** The runs before now are listed too. */
  readonly previous: boolean;
  /** The builder is shown under the input. */
  readonly builder: boolean;
  readonly indent: Indent;
}

const readOptions = (value: unknown): Options => {
  const { zone, count, numbering, previous, builder, indent } = stored(value);
  return { zone: typeof zone === 'string' ? zone : '', count: oneOf(COUNTS, count), numbering: oneOf(NUMBERINGS, numbering), previous: previous === true, builder: builder !== false, indent: readIndent(indent) };
};

/**
 * Schedules read, in the forms people meet them in: crontab (five fields),
 * six with seconds first, Quartz (seven with a year, `L`, `W`, `#`, `?`),
 * the aliases such as `@daily`, AWS EventBridge (`cron(…)` and `rate(…)`)
 * and systemd (`OnCalendar`). Each line is a schedule, and its form is told
 * from how it is written. What comes back: what it says, in the language of
 * the program, its fields, when it next runs and when it last ran, by the
 * clocks of its zone, and how each other form writes it; the same as JSON,
 * to copy or save. A schedule can also be made by choosing, in the builder
 * under the input.
 */
export default function Cron(props: ToolProps) {
  const t = useTranslation();
  const [options, change] = useOptions(props.host, 'cron.options', readOptions);
  const [schedules, setSchedules] = useState<readonly CronTold[] | null>(null);
  const [put, setPut] = useState<TextToPut | undefined>(undefined);
  /** A schedule taken up in the builder from what was typed. */
  const [toBuild, setToBuild] = useState<Built | undefined>(undefined);

  // What the Rust side wrote is JSON: it is read back here, to be laid out.
  const read = useCallback((text: string | null) => {
    try {
      setSchedules(text === null ? null : (JSON.parse(text) as CronTold[]));
    } catch {
      setSchedules(null);
    }
  }, []);

  return (
    <InspectTool
      {...props}
      tool="cron"
      options={{ zone: options.zone.trim() === '' ? systemZone() : options.zone.trim(), count: Number(options.count), numbering: options.numbering }}
      optionsView={
        <>
          <TextBox label={t('dev.time.zone')} value={options.zone} code hint={systemZone()} onChange={(zone) => change({ zone })} />
          <Choice label={t('dev.cron.numbering')} value={options.numbering} options={NUMBERINGS.map((value) => ({ value, label: t(`dev.cron.numbering.${value}`) }))} onChange={(numbering) => change({ numbering })} />
          <Choice label={t('dev.cron.count')} value={options.count} options={COUNTS.map((value) => ({ value, label: value }))} onChange={(count) => change({ count })} />
          <Toggle label={t('dev.cron.showPrevious')} checked={options.previous} onChange={(previous) => change({ previous })} />
          <Toggle label={t('dev.cron.builder')} checked={options.builder} onChange={(builder) => change({ builder })} />
        </>
      }
      indent={options.indent}
      onIndent={(indent) => change({ indent })}
      onText={read}
      put={put}
      below={options.builder ? () => <CronBuilder load={toBuild} onUse={(text, add) => setPut({ text, add })} /> : undefined}
      extra={{ label: t('dev.cron.explained'), resultLabel: 'JSON', first: true, view: <CronView schedules={schedules} previous={options.previous} onUse={(text) => setPut({ text, add: true })}
            onBuild={(built) => {
              // A copy each time, so the same schedule taken up twice is shown twice.
              setToBuild({ ...built });
              if (!options.builder) change({ builder: true });
            }}
          /> }}
      opens={{ typeName: t('dev.codec.textFiles'), extensions: ['txt', 'cron', 'crontab', 'timer'] }}
      mark="cron"
      fine={t('dev.cron.fine')}
      workTitle={t('dev.cron.working')}
    />
  );
}
