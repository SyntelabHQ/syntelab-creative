/** A day as a date field holds it: `2026-10-10`, by the clock of this computer. */
export function dayOf(moment: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  return `${moment.getFullYear()}-${two(moment.getMonth() + 1)}-${two(moment.getDate())}`;
}

/**
 * A day (as a date field holds it) written the way the language of the
 * program writes dates: `10.10.2026`, `10/10/2026`… Empty when it is no day.
 */
export function writtenDate(day: string, language: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!parts) return '';
  // At noon, so no time zone can move it to the day before or after.
  const moment = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 12);
  if (Number.isNaN(moment.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(language, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(moment);
  } catch {
    return `${parts[3]}.${parts[2]}.${parts[1]}`;
  }
}
