import { describe, expect, it } from 'vitest';
import { loadPresets, presetLines, STANDARD_PRESET, withPreset } from './signature-presets';
import type { SignaturePreset } from './signature-presets';

const words = { signedBy: 'Digitally signed by {value}', date: 'Date: {value}', reason: 'Reason: {value}', location: 'Place: {value}' };
const facts = { signer: 'Ana Popescu', moment: '10.10.2026, 15:57', reason: 'Aprobare', location: '' };
const company: SignaturePreset = { ...STANDARD_PRESET, id: 'p1', name: 'Company', showReason: true, showLocation: true, extra: 'Administrator\nSyntelab SRL' };

describe('looks of a signature', () => {
  it('writes the lines that are asked for, each saying what it is', () => {
    expect(presetLines(STANDARD_PRESET, facts, words)).toEqual(['Digitally signed by Ana Popescu', 'Date: 10.10.2026, 15:57']);
  });

  it('puts the lines of one’s own after the name, and leaves out what is empty', () => {
    // No place was given: its line is not written.
    expect(presetLines(company, facts, words)).toEqual(['Digitally signed by Ana Popescu', 'Administrator', 'Syntelab SRL', 'Date: 10.10.2026, 15:57', 'Reason: Aprobare']);
  });

  it('writes the bare facts without labels', () => {
    expect(presetLines({ ...STANDARD_PRESET, labels: false }, facts, words)).toEqual(['Ana Popescu', '10.10.2026, 15:57']);
  });

  it('replaces a look that is saved again, and adds a new one at the end', () => {
    const renamed = { ...company, name: 'For the company' };
    expect(withPreset([company], renamed)).toEqual([renamed]);
    expect(withPreset([company], { ...company, id: 'p2' }).map((preset) => preset.id)).toEqual(['p1', 'p2']);
  });

  it('reads back only what is a look, made whole', () => {
    const stored = [{ id: 'p1', name: 'Stamp', picture: { address: 'data:image/png;base64,AA', width: 10, height: 10 }, extra: '' }, { id: 'standard', name: 'x', picture: null, extra: '' }, 'nonsense', { id: 'p3', name: 'Bad', picture: { address: 'http://x', width: 1, height: 1 }, extra: '' }];
    const presets = loadPresets({ loadData: <T,>() => stored as T });
    expect(presets.map((preset) => preset.id)).toEqual(['p1']);
    expect(presets[0]).toMatchObject({ showName: true, showDate: true, showReason: false, labels: true });
  });
});
