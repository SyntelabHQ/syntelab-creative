import { useEffect, useState } from 'react';

/** How long the program runs before the support heart asks for attention. */
const QUIET_MILLISECONDS = 60_000;
/** How long the heart then beats before it settles. */
const BEAT_MILLISECONDS = 4_000;

/**
 * `idle`: nothing yet. `beating`: the heart is green and beats.
 * `resting`: it stays green, without moving, until the program closes.
 */
export type SupportNudge = 'idle' | 'beating' | 'resting';

/** One gentle reminder per run of the program: a minute in, the heart beats for a few seconds. */
export function useSupportNudge(): SupportNudge {
  const [nudge, setNudge] = useState<SupportNudge>('idle');

  useEffect(() => {
    const start = setTimeout(() => setNudge('beating'), QUIET_MILLISECONDS);
    const stop = setTimeout(() => setNudge('resting'), QUIET_MILLISECONDS + BEAT_MILLISECONDS);
    return () => {
      clearTimeout(start);
      clearTimeout(stop);
    };
  }, []);

  return nudge;
}
