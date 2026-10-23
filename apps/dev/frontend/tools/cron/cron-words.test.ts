import { describe, expect, it } from 'vitest';
import { cronWords, fromNow, monthName, weekdayName } from './cron-words';
import type { CronField, CronTold } from './cron-words';

/** The translations as their keys with their values after: what was asked for is what is checked. */
const t = (key: string, values?: Record<string, string>) => (values ? `${key.replace('dev.cron.say.', '')}(${Object.values(values).join('|')})` : key.replace('dev.cron.say.', ''));

const field = (values: readonly number[], more: Partial<CronField> = {}): CronField => ({ written: '', every: false, step: null, values, ...more });
const every = (count: number, from = 0, more: Partial<CronField> = {}) => field(Array.from({ length: count }, (_, at) => at + from), { every: true, ...more });
const told = (fields: CronTold['fields'], more: Partial<CronTold> = {}): CronTold => ({ expression: '', says: 'in English', form: 'crontab', zone: 'UTC', fields: { minute: every(60), hour: every(24), dayOfMonth: every(31, 1), month: every(12, 1), dayOfWeek: every(7), ...fields }, next: [], nextUnix: [], ...more });
const words = (fields: CronTold['fields'], more?: Partial<CronTold>) => cronWords(told(fields, more), t, 'en');

describe('cronWords', () => {
  it('says when in the day', () => {
    expect(words({ minute: field([30]), hour: field([2]) })).toBe('at(02:30)joineveryDay');
    expect(words({})).toBe('everyMinutejoineveryDay');
    expect(words({ minute: every(4, 0, { every: false, step: 15, values: [0, 15, 30, 45] }) })).toBe('everyNMinutes(15)joineveryDay');
    expect(words({ minute: field([0]) })).toBe('minuteOfEveryHour(0)joineveryDay');
    expect(words({ minute: field([0]), hour: field([0, 6, 12, 18], { step: 6 }) })).toBe('minuteOfEveryNHours(0|6)joineveryDay');
    expect(words({ minute: field([15, 45]), hour: field([8, 9]) })).toBe('minutesOfHours(15 and 45|8 and 9)joineveryDay');
    expect(words({ hour: field([9, 10]) })).toBe('everyMinuteOfHours(9 and 10)joineveryDay');
    expect(words({ hour: field([9]) })).toBe('everyMinuteBetween(09:00|09:59)joineveryDay');
    expect(words({ minute: field([0, 5], { step: 5 }), hour: field([9]) })).toBe('everyNMinutesBetween(5|09:00|09:59)joineveryDay');
  });

  it('says the seconds when the schedule has them', () => {
    expect(words({ second: field([0]), minute: field([0]), hour: field([12]) })).toBe('at(12:00)joineveryDay');
    expect(words({ second: field([0, 10, 20, 30, 40, 50], { step: 10 }) })).toBe('everyMinutejoineveryNSeconds(10)joineveryDay');
    expect(words({ second: field([5, 35]) })).toBe('everyMinutejoinatSeconds(5 and 35)joineveryDay');
  });

  it('says the days, the months and the years', () => {
    const at = { minute: field([0]), hour: field([9]) };
    expect(words({ ...at, dayOfWeek: field([1, 5]) })).toBe('at(09:00)joinonWeekdays(Monday and Friday)');
    expect(words({ ...at, dayOfMonth: field([1, 15]) })).toBe('at(09:00)joinonDays(1 and 15)');
    expect(words({ ...at, dayOfMonth: field([13]), dayOfWeek: field([5]) })).toBe('at(09:00)joinonDays(13) or onWeekdays(Friday)');
    expect(words({ ...at, month: field([1, 7]) })).toBe('at(09:00)joineveryDayjoininMonths(January and July)');
    expect(words({ ...at, year: field([2030]) })).toBe('at(09:00)joineveryDayjoininYears(2030)');
    // Three or more that follow one another are a span.
    expect(words({ hour: field([9, 10, 11, 12, 17]), dayOfWeek: field([1, 2, 3, 4, 5]) })).toBe('everyMinuteOfHours(9–12 and 17)joinonWeekdays(Monday–Friday)');
  });

  it('says what Quartz adds', () => {
    const at = { minute: field([0]), hour: field([0]) };
    expect(words({ ...at, dayOfMonth: field([], { last: 0 }) })).toBe('at(00:00)joinlastDay');
    expect(words({ ...at, dayOfMonth: field([], { last: 3 }) })).toBe('at(00:00)joinbeforeLast(3)');
    expect(words({ ...at, dayOfMonth: field([], { lastWorking: true }) })).toBe('at(00:00)joinlastWorking');
    expect(words({ ...at, dayOfMonth: field([], { nearestWorking: [15] }) })).toBe('at(00:00)joinnearestWorking(15)');
    expect(words({ ...at, dayOfWeek: field([], { lastOf: [5] }) })).toBe('at(00:00)joinlastWeekday(Friday)');
    expect(words({ ...at, dayOfWeek: field([], { nth: [{ day: 1, nth: 2 }] }) })).toBe('at(00:00)joinnthWeekday(nth.2|Monday)');
    expect(words({}, { atStart: true })).toBe('atStart');
  });

  it('names days and months in the language asked for', () => {
    expect([weekdayName(0, 'en'), weekdayName(6, 'en'), weekdayName(1, 'ro')]).toEqual(['Sunday', 'Saturday', 'luni']);
    expect([monthName(1, 'en'), monthName(12, 'ro')]).toEqual(['January', 'decembrie']);
  });

  it('tells how far a moment is', () => {
    expect(fromNow(1000 + 3 * 3600, 1000, 'en')).toBe('in 3 hours');
    expect(fromNow(1000 + 86_400, 1000, 'en')).toBe('tomorrow');
    expect(fromNow(1000 + 45, 1000, 'en')).toBe('in 45 seconds');
  });
});
