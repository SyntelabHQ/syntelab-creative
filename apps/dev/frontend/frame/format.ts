/** How sizes and times are written in the line under a tool. */

const SIZES = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/** A size in bytes as a person reads it: `512 B`, `1.5 KB`, `370 MB`. Counted in steps of 1024. */
export function formatBytes(bytes: number, language: string): string {
  let value = Math.max(0, bytes);
  let step = 0;
  while (value >= 1024 && step < SIZES.length - 1) {
    value /= 1024;
    step += 1;
  }
  // One decimal while the number is short; none for bytes, which are whole.
  const decimals = step === 0 || value >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: decimals }).format(value)} ${SIZES[step]}`;
}

/** How long something took: `12 ms`, `1.3 s`, `2 min 5 s`. */
export function formatDuration(milliseconds: number, language: string): string {
  const number = (value: number, decimals = 0) => new Intl.NumberFormat(language, { maximumFractionDigits: decimals }).format(value);
  if (milliseconds < 1000) return `${number(Math.max(0, Math.round(milliseconds)))} ms`;
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${number(seconds, 1)} s`;
  return `${number(Math.floor(seconds / 60))} min ${number(Math.round(seconds % 60))} s`;
}
