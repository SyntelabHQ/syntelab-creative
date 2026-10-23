import { describe, expect, it } from 'vitest';
import { build, read, STARTS_WITH, writtenField } from './cron-build';
import type { Built, BuiltField } from './cron-build';

const chosen = (...values: number[]): BuiltField => ({ mode: 'chosen', step: 5, chosen: values });
const step = (by: number): BuiltField => ({ mode: 'step', step: by, chosen: [] });

describe('build', () => {
  it('starts with every day at nine', () => {
    expect(build(STARTS_WITH)).toBe('0 9 * * *');
    expect(build({ ...STARTS_WITH, withSeconds: true })).toBe('0 0 9 * * *');
  });

  it('writes steps, lists and ranges', () => {
    expect(build({ ...STARTS_WITH, minute: step(15), hour: chosen(17, 9, 10, 11, 13), dayOfWeek: chosen(1, 2, 3, 4, 5) })).toBe('*/15 9-11,13,17 * * 1-5');
    expect(build({ ...STARTS_WITH, dayOfMonth: chosen(1, 15), month: chosen(1, 7) })).toBe('0 9 1,15 1,7 *');
    expect(build({ ...STARTS_WITH, withSeconds: true, second: step(10), minute: { mode: 'every', step: 5, chosen: [] }, hour: { mode: 'every', step: 5, chosen: [] } })).toBe('*/10 * * * * *');
  });

  it('takes nothing picked, everything picked and a step of one for every value', () => {
    expect(writtenField(chosen(), [0, 59])).toBe('*');
    expect(writtenField(chosen(0, 1, 2, 3, 4, 5, 6), [0, 6])).toBe('*');
    expect(writtenField(step(1), [0, 59])).toBe('*');
    expect(writtenField(chosen(3, 3, 99), [0, 59])).toBe('3');
  });
});

describe('a schedule read back into the builder', () => {
  it('is what the builder writes, and is written again the same', () => {
    for (const written of ['0 9 * * *', '*/5 9-17 * * 1-5', '30 2 1,15 * *', '0 0 12 * * 0', '*/10 * * * * *']) expect(build(read(written) as Built), written).toBe(written);
  });

  it('takes names, steps over a range and Sunday written as 7', () => {
    expect(build(read('0 9 * jan-mar mon,WED') as Built)).toBe('0 9 * 1-3 1,3');
    expect(build(read('0-30/10 * * * 7') as Built)).toBe('0,10,20,30 * * * 0');
    expect(build(read('5/20 * * * *') as Built)).toBe('5,25,45 * * * *');
  });

  it('is nothing for what the builder cannot choose', () => {
    for (const written of ['0 9 L * *', '0 9 * * 1#2', '0 9 15W * *', '0 9 ? * *', '61 * * * *', '0 9 * *', '@daily', '0 9 * * * * 2030']) expect(read(written), written).toBeNull();
  });
});
