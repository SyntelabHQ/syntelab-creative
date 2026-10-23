import { useI18n } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { ProgressCard } from '@syntelab/ui-kit';
import { useEffect, useState } from 'react';
import { stopWork, workProgress } from './table-api';
import type { Progress } from './table-api';

/** The long work a table does: what the card over it is titled with. */
export type WorkKind = 'pasting' | 'importing' | 'exporting' | 'copying';

export interface WorkProgressProps {
  readonly host: Pick<AppHost, 'invoke'>;
  readonly kind: WorkKind;
}

/** How often the Rust side is asked how far it has got. */
const ASKED_EVERY = 150;

/**
 * Lies over a table while it does something long (very many rows pasted,
 * imported, exported): how far it has got, and a button that stops it. The
 * table under it cannot be touched meanwhile. The work itself runs on the
 * Rust side; here it is only asked about, again and again.
 */
export function WorkProgress({ host, kind }: WorkProgressProps) {
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
  // What is to be read is still being read; or every row is done and the work is being finished (a file saved, a copy made).
  const stage = stopping ? t('units.work.stopping') : part === null ? t('units.work.preparing') : part >= 1 ? t('units.work.finishing') : t('units.work.rows', { done: count(Math.min(progress?.done ?? 0, progress?.total ?? 0)), total: count(progress?.total ?? 0) });

  return (
    <ProgressCard
      title={t(`units.work.${kind}`)}
      part={part}
      stage={stage}
      stopLabel={t('units.work.stop')}
      stopping={stopping}
      onStop={() => {
        setStopping(true);
        void stopWork(host).catch(() => {});
      }}
    />
  );
}
