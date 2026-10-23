import { useI18n } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { ProgressCard } from '@syntelab/ui-kit';
import { useEffect, useState } from 'react';
import { stopWork, workProgress } from '../api/dev-api';
import type { Progress } from '../api/dev-api';
import { formatBytes } from './format';

export interface ToolProgressProps {
  readonly host: Pick<AppHost, 'invoke'>;
  /** What is being done, already translated. */
  readonly title: string;
  /** How far the work has got is counted in things (ports tried, questions asked), not in bytes read. */
  readonly counted?: boolean;
}

/** How often the Rust side is asked how far it has got. */
const ASKED_EVERY = 150;

/**
 * The card over a tool while it does something long: how far it has got (in
 * bytes read, and in files when there are many), and a button that stops it.
 * The work runs on the Rust side; here it is only asked about, again and again.
 */
export function ToolProgress({ host, title, counted }: ToolProgressProps) {
  const { t, language } = useI18n();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    const ask = setInterval(() => void workProgress(host).then(setProgress, () => {}), ASKED_EVERY);
    return () => clearInterval(ask);
  }, [host.invoke]);

  const known = progress !== null && progress.running && progress.total > 0;
  const part = known ? Math.min(1, progress.done / progress.total) : null;
  const count = (value: number) => new Intl.NumberFormat(language).format(value);
  const amount = (value: number) => (counted ? count(value) : formatBytes(value, language));
  // A size that is not known (a server that does not say how much it sends) is not written as nothing.
  const read = (progress?.total ?? 0) > 0 ? t('dev.work.read', { done: amount(progress?.done ?? 0), total: amount(progress?.total ?? 0) }) : amount(progress?.done ?? 0);
  const stage = stopping
    ? t('dev.work.stopping')
    : part === null
      ? t('dev.work.preparing')
      : (progress?.files ?? 0) > 0
        ? t('dev.work.files', { file: count(progress?.file ?? 0), files: count(progress?.files ?? 0), read })
        : part >= 1
          ? t('dev.work.finishing')
          : read;
  return (
    <ProgressCard
      title={title}
      part={part}
      stage={stage}
      stopLabel={t('dev.work.stop')}
      stopping={stopping}
      onStop={() => {
        setStopping(true);
        void stopWork(host).catch(() => {});
      }}
    />
  );
}
