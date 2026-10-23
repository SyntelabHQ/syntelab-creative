/** A field of a schedule as the Rust side tells it. */
export interface CronField {
  /** As it was written. */
  readonly written: string;
  /** Written as a step over all its values (a star, a slash and a number): every n-th of them. */
  readonly every: boolean;
  /** Written as `*​/n`: every n-th of all its values. */
  readonly step: number | null;
  readonly values: readonly number[];
  /** Day of month: the last day, and how many days before it. */
  readonly last?: number;
  readonly lastWorking?: boolean;
  /** Day of month: the working day nearest each of these. */
  readonly nearestWorking?: readonly number[];
  /** Day of week (0 is Sunday): the last of each of these in the month. */
  readonly lastOf?: readonly number[];
  /** Day of week: the n-th of a day in the month. */
  readonly nth?: readonly { readonly day: number; readonly nth: number }[];
}

/** A schedule as the Rust side tells it. */
export interface CronTold {
  readonly expression: string;
  /** What it says, in English: kept for the JSON; the interface says it in its own language. */
  readonly says: string;
  readonly form: 'crontab' | 'with seconds' | 'quartz' | 'alias' | 'aws' | 'systemd' | 'rate';
  /** The zone its times are told in; none for a rate, which has no times. */
  readonly zone?: string;
  readonly fields?: Readonly<Partial<Record<'second' | 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek' | 'year', CronField>>>;
  /** `rate(5 minutes)`: every so many, counted from when the rule was made. */
  readonly rate?: { readonly value: number; readonly unit: 'minute' | 'hour' | 'day' };
  /** The next runs, as ISO 8601 with the offset of the zone, and as seconds since 1970. */
  readonly next: readonly string[];
  readonly nextUnix: readonly number[];
  /** The runs before now, the nearest first. */
  readonly previous?: readonly string[];
  readonly previousUnix?: readonly number[];
  /** The schedule as each form writes it; null where a form cannot say it. */
  readonly asOther?: Readonly<Record<'crontab' | 'withSeconds' | 'quartz' | 'aws' | 'systemd', string | null>>;
  /** A day of the month and a day of the week are both given, and it runs on a day that is both (systemd). */
  readonly bothDays?: boolean;
  readonly atStart?: boolean;
  /** A day of the month and a day of the week are both given: it runs on a day that is either. */
  readonly eitherDay?: boolean;
  /** Fewer runs were found than asked for: it does not run so often in the years looked through. */
  readonly runsOut?: boolean;
}

type Translate = (key: string, values?: Record<string, string>) => string;

/** The name of a day of the week (0 is Sunday) and of a month (1 is January), in a language. 2023 began on a Sunday. */
export const weekdayName = (day: number, language: string) => new Intl.DateTimeFormat(language, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + (day % 7))));
export const monthName = (month: number, language: string) => new Intl.DateTimeFormat(language, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, month - 1, 1)));

/**
 * What a schedule says, in the words of a language: when in the hour and
 * the day, on which days, in which months and years. Made from the fields
 * as they were read, so it says what the schedule does, not how it was
 * written.
 */
export function cronWords(told: CronTold, t: Translate, language: string): string {
  if (told.atStart) return t('dev.cron.say.atStart');
  if (told.rate) return t(`dev.cron.say.rate.${told.rate.unit}`, { n: new Intl.NumberFormat(language).format(told.rate.value) });
  if (!told.fields) return told.says;
  const number = (value: number) => new Intl.NumberFormat(language, { useGrouping: false }).format(value);
  const and = (items: readonly string[]) => new Intl.ListFormat(language, { style: 'long', type: 'conjunction' }).format(items);
  const or = (items: readonly string[]) => new Intl.ListFormat(language, { style: 'long', type: 'disjunction' }).format(items);
  /** Values in order, as a list in which three or more that follow one another are written as a span: 9–17, Monday–Friday. */
  const spans = (values: readonly number[], name: (value: number) => string) => {
    const parts: string[] = [];
    for (let at = 0; at < values.length; ) {
      let end = at;
      while (end + 1 < values.length && values[end + 1] === (values[end] ?? 0) + 1) end += 1;
      if (end - at >= 2) parts.push(`${name(values[at] ?? 0)}–${name(values[end] ?? 0)}`);
      else for (let one = at; one <= end; one++) parts.push(name(values[one] ?? 0));
      at = end + 1;
    }
    return and(parts);
  };
  const numbers = (field: CronField) => spans(field.values, number);
  const all = (field: CronField) => field.every || field.step !== null;
  const { second, minute, hour, dayOfMonth, month, dayOfWeek, year } = told.fields;
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return told.says;
  const parts: string[] = [];

  // When in the day.
  const oneMinute = minute.values.length === 1 ? minute.values[0] : undefined;
  const oneHour = hour.values.length === 1 ? hour.values[0] : undefined;
  if (oneMinute !== undefined && oneHour !== undefined) {
    const time = new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1, oneHour, oneMinute)));
    parts.push(t('dev.cron.say.at', { time }));
  } else if (all(minute) && hour.every) {
    parts.push(minute.step !== null && minute.step > 1 ? t('dev.cron.say.everyNMinutes', { n: number(minute.step) }) : t('dev.cron.say.everyMinute'));
  } else if (oneMinute !== undefined && all(hour)) {
    parts.push(hour.step !== null && hour.step > 1 ? t('dev.cron.say.minuteOfEveryNHours', { minutes: number(oneMinute), n: number(hour.step) }) : t('dev.cron.say.minuteOfEveryHour', { minutes: number(oneMinute) }));
  } else if (all(minute) && oneHour !== undefined) {
    // Within one hour: said as the stretch of the clock it is.
    const clock = (minuteOf: number) => new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1, oneHour, minuteOf)));
    const between = { from: clock(0), to: clock(59) };
    parts.push(minute.step !== null && minute.step > 1 ? t('dev.cron.say.everyNMinutesBetween', { n: number(minute.step), ...between }) : t('dev.cron.say.everyMinuteBetween', between));
  } else if (all(minute)) {
    parts.push(minute.step !== null && minute.step > 1 ? t('dev.cron.say.everyNMinutesOfHours', { n: number(minute.step), hours: numbers(hour) }) : t('dev.cron.say.everyMinuteOfHours', { hours: numbers(hour) }));
  } else if (hour.every) {
    parts.push(t('dev.cron.say.minuteOfEveryHour', { minutes: numbers(minute) }));
  } else {
    parts.push(t('dev.cron.say.minutesOfHours', { minutes: numbers(minute), hours: numbers(hour) }));
  }
  if (second) {
    if (all(second)) parts.push(second.step !== null && second.step > 1 ? t('dev.cron.say.everyNSeconds', { n: number(second.step) }) : t('dev.cron.say.everySecond'));
    else if (!(second.values.length === 1 && second.values[0] === 0)) parts.push(t('dev.cron.say.atSeconds', { seconds: numbers(second) }));
  }

  // On which days.
  const ofMonth: string[] = [];
  if (dayOfMonth.values.length > 0) ofMonth.push(t('dev.cron.say.onDays', { days: numbers(dayOfMonth) }));
  if (dayOfMonth.last === 0) ofMonth.push(t('dev.cron.say.lastDay'));
  else if (dayOfMonth.last !== undefined) ofMonth.push(t('dev.cron.say.beforeLast', { n: number(dayOfMonth.last) }));
  if (dayOfMonth.lastWorking) ofMonth.push(t('dev.cron.say.lastWorking'));
  for (const day of dayOfMonth.nearestWorking ?? []) ofMonth.push(t('dev.cron.say.nearestWorking', { day: number(day) }));
  const ofWeek: string[] = [];
  if (dayOfWeek.values.length > 0) ofWeek.push(t('dev.cron.say.onWeekdays', { days: spans(dayOfWeek.values, (day) => weekdayName(day, language)) }));
  for (const day of dayOfWeek.lastOf ?? []) ofWeek.push(t('dev.cron.say.lastWeekday', { day: weekdayName(day, language) }));
  for (const one of dayOfWeek.nth ?? []) ofWeek.push(t('dev.cron.say.nthWeekday', { nth: t(`dev.cron.say.nth.${Math.min(Math.max(one.nth, 1), 5)}`), day: weekdayName(one.day, language) }));
  if (dayOfMonth.every && dayOfWeek.every) parts.push(t('dev.cron.say.everyDay'));
  else if (dayOfWeek.every) parts.push(and(ofMonth));
  else if (dayOfMonth.every) parts.push(and(ofWeek));
  else if (told.bothDays) parts.push(t('dev.cron.say.bothDays', { month: and(ofMonth), week: and(ofWeek) }));
  else parts.push(or([and(ofMonth), and(ofWeek)]));

  if (!month.every) parts.push(t('dev.cron.say.inMonths', { months: spans(month.values, (value) => monthName(value, language)) }));
  if (year && !year.every) parts.push(t('dev.cron.say.inYears', { years: spans(year.values, number) }));
  return parts.join(t('dev.cron.say.join'));
}

/** How far a moment is from now, in the words of a language: "in 3 hours", "tomorrow". */
export function fromNow(seconds: number, now: number, language: string): string {
  const far = seconds - now;
  const units: readonly [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 365 * 86_400],
    ['month', 30 * 86_400],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ];
  const [unit, size] = units.find(([, each]) => Math.abs(far) >= each) ?? ['second', 1];
  return new Intl.RelativeTimeFormat(language, { numeric: 'auto' }).format(Math.round(far / size), unit);
}
