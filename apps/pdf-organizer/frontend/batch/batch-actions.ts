import { fileName, folderOf } from '@syntelab/shell-api';
import { DEFAULT_NUMBERING, numberMark, numberOfPage } from '../document/page-numbers';
import type { NumberFormat, NumberWords, PageNumbering } from '../document/page-numbers';
import type { PlanPage, QuarterTurns } from '../document/page-plan';
import type { Place } from '../document/page-shape';
import { exportRequest } from '../export/export-formats';
import type { ExportChoice } from '../export/export-formats';
import { pageTextMarks, startPageTexts } from '../insert/page-texts';
import { watermarkOn } from '../insert/watermark-marks';
import type { WatermarkAngle } from '../insert/watermark-marks';
import type { Mark } from '../marks/mark';
import { COMPRESS_LEVELS } from '../organize/compress-dialog';
import type { CompressLevel } from '../organize/compress-dialog';
import { spotAt, spotBox } from './sign-settings';

/**
 * Batch processing: the same things done to many files, each result written
 * to a folder under a name made from the file's own. A file already there,
 * even one of the files themselves, is written over only when the user says so.
 */

/**
 * What can be done to each file, in the order it is done. Every file becomes
 * a PDF first (a PDF stays as it is); with nothing else chosen, that is all.
 */
export const BATCH_STEPS = ['rotate', 'ocr', 'header', 'watermark', 'numbers', 'compress', 'sign', 'export'] as const;
export type BatchStep = (typeof BATCH_STEPS)[number];

/** What is done to each file: which steps, each with its choices. */
export interface BatchJob {
  readonly steps: readonly BatchStep[];
  /** How far every page is turned, clockwise. */
  readonly turn: 90 | 180 | 270;
  /** The languages scanned pages are read in, by the names the engine gives them. */
  readonly ocrLanguages: readonly string[];
  /** Written at the top and at the bottom of every page, in the middle. `{page}`, `{pages}`, `{date}` and `{file}` are filled in. */
  readonly headerText: string;
  readonly footerText: string;
  /** Words written across every page, faint. */
  readonly watermarkText: string;
  readonly watermarkAngle: WatermarkAngle;
  readonly numberFormat: NumberFormat;
  readonly numberPlace: Place;
  readonly level: CompressLevel;
  readonly choice: ExportChoice;
}

export const DEFAULT_JOB: BatchJob = {
  steps: [],
  turn: 90,
  ocrLanguages: [],
  headerText: '',
  footerText: '',
  watermarkText: '',
  watermarkAngle: 'rising',
  numberFormat: 'plain',
  numberPlace: 'bottom-right',
  level: 'balanced',
  choice: { format: 'docx', resolution: 150, quality: 85 },
};

export const has = (job: BatchJob, step: BatchStep): boolean => job.steps.includes(step);

/**
 * The steps with one turned on or off, in the order they are done. Writing
 * out in another format gives no PDF: it cannot go with what only a PDF can
 * be given (smaller pictures, a signature), so turning one on turns the
 * other off.
 */
export function withStep(steps: readonly BatchStep[], step: BatchStep, on: boolean): BatchStep[] {
  const wanted = new Set(steps);
  if (on) {
    wanted.add(step);
    if (step === 'export') for (const other of ['compress', 'sign'] as const) wanted.delete(other);
    if (step === 'compress' || step === 'sign') wanted.delete('export');
  } else wanted.delete(step);
  return BATCH_STEPS.filter((known) => wanted.has(known));
}

/** What a run writes: a result for each file, or every file's pages gathered in one PDF, in the order of the list. */
export const BATCH_OUTPUTS = ['each', 'one'] as const;
export type BatchOutput = (typeof BATCH_OUTPUTS)[number];

/** Whether the files can be gathered in one result: only into a PDF. */
export function canBeOne(job: BatchJob): boolean {
  return !has(job, 'export');
}

/** What is added to a file's name for its result, unless the user writes something else: said by the last thing done to it. */
export function defaultSuffix(job: BatchJob): string {
  if (has(job, 'export')) return '';
  if (has(job, 'sign')) return '_signed';
  if (has(job, 'compress')) return '_small';
  if (has(job, 'numbers')) return '_numbered';
  if (has(job, 'watermark')) return '_marked';
  if (has(job, 'header')) return '_header';
  if (has(job, 'ocr')) return '_searchable';
  return has(job, 'rotate') ? '_rotated' : '';
}

/** The ending of the files a job writes. */
export function resultEnding(job: BatchJob): string {
  return has(job, 'export') ? job.choice.format : 'pdf';
}

const withoutEnding = (name: string) => (name.lastIndexOf('.') > 0 ? name.slice(0, name.lastIndexOf('.')) : name);

/**
 * The name of each file's result: its own name, what is added to it, the
 * ending. Two files of one name (from different folders) are told apart by a
 * number, so one result does not take the place of the other.
 */
export function resultNames(paths: readonly string[], added: string, ending: string): string[] {
  const taken = new Set<string>();
  // Letters a file name cannot have are left out of what the user typed.
  const safe = added.replace(/[\\/:*?"<>|]/g, '');
  return paths.map((path) => {
    const base = `${withoutEnding(fileName(path))}${safe}`;
    let name = `${base}.${ending}`;
    for (let number = 2; taken.has(name.toLowerCase()); number++) name = `${base}_${number}.${ending}`;
    taken.add(name.toLowerCase());
    return name;
  });
}

/** Where a result goes: the folder, and its name in it. */
export function inFolder(folder: string, name: string): string {
  const separator = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
  return `${folder.replace(/[\\/]+$/, '')}${separator}${name}`;
}

/** Where each file's result goes: the folder, or the folder under it that the file lies in (by the file's path), and its name. */
export function resultPaths(files: readonly string[], under: ReadonlyMap<string, string>, folder: string, names: readonly string[]): string[] {
  return files.map((path, index) => {
    const lies = under.get(path) ?? '';
    return inFolder(lies === '' ? folder : inFolder(folder, lies), names[index] ?? '');
  });
}

/**
 * The folder all the files come from, or null when they come from several (or there are none). A file that came with
 * an added folder comes from that folder, not from the one under it that it lies in.
 */
export function commonFolder(files: readonly string[], under: ReadonlyMap<string, string>): string | null {
  let common: string | null = null;
  for (const path of files) {
    const depth = (under.get(path) ?? '').split('/').filter((part) => part !== '').length;
    let folder = folderOf(path);
    for (let level = 0; level < depth; level++) folder = folderOf(folder);
    if (folder === '') return null;
    if (common === null) common = folder;
    else if (!samePlace(common, folder)) return null;
  }
  return common;
}

/** Windows does not tell big letters from small ones in names. */
const samePlace = (a: string, b: string) => (a.includes('\\') ? a.toLowerCase() === b.toLowerCase() : a === b);

/** The name of the one file when none is typed and none is set (Settings → Names of new documents). */
const DEFAULT_ONE_NAME = 'syntelab-combined';

/** The name of the one file everything is gathered in: what the user typed, made fit for a file name. */
export function oneName(typed: string): string {
  const safe = typed.replace(/[\\/:*?"<>|]/g, '').trim().replace(/\.pdf$/i, '').trim();
  return `${safe === '' ? DEFAULT_ONE_NAME : safe}.pdf`;
}

/** Where a signature shows on a page of a size, at one of the usual places: a box from the page's top-left corner. */
export function signatureBox(pageWidth: number, pageHeight: number, place: Place): { x: number; y: number; width: number; height: number } {
  return spotBox(pageWidth, pageHeight, spotAt(place));
}

/** What the pages are drawn on with: how text is measured, the words of the language, the day, the file. */
export interface PageTools {
  readonly words: NumberWords;
  /** Gives a text mark the size its text takes. */
  readonly fitted: (mark: Mark) => Mark;
  /** Words as a mark of no particular size or place, and that mark made as wide as asked (see `watermark-sample.ts`). */
  readonly sample: (text: string) => Mark;
  readonly scaled: (mark: Mark, width: number) => Mark;
  /** Today, already written in the language of the program: what `{date}` stands for. */
  readonly today: string;
  /** The name of the file the pages are of: what `{file}` stands for. */
  readonly file: string;
}

/** How a watermark of batch processing lies: across most of the page, faint. */
const WATERMARK_SHARE = 0.75;
const WATERMARK_OPACITY = 0.2;

/**
 * The pages of a file as the job leaves them: turned, then written on (a
 * header and a footer, words across, numbers; all stand upright on a turned
 * page). Reading scanned pages is not done here: it asks the engine, page by
 * page (see `use-batch-run.ts`).
 */
export function pagesAfter(job: BatchJob, plan: readonly PlanPage[], tools: PageTools): PlanPage[] {
  const { words, fitted } = tools;
  let pages = [...plan];
  const withMarks = (page: PlanPage, marks: readonly Mark[]): PlanPage => (marks.length === 0 ? page : { ...page, marks: [...(page.marks ?? []), ...marks] });
  if (has(job, 'rotate')) pages = pages.map((page) => ({ ...page, rotation: ((page.rotation + job.turn) % 360) as QuarterTurns }));
  if (has(job, 'header') && (job.headerText.trim() !== '' || job.footerText.trim() !== '')) {
    const start = startPageTexts('header-footer', new Set());
    const settings = { ...start, texts: { ...start.texts, 'top-center': job.headerText, 'bottom-center': job.footerText } };
    const turned = pages;
    pages = pages.map((page, index) => withMarks(page, pageTextMarks(settings, turned, index, tools.today, tools.file, fitted, `batch-text-${index}`)));
  }
  if (has(job, 'watermark') && job.watermarkText.trim() !== '') {
    const sample = tools.sample(job.watermarkText.trim());
    const options = { place: { across: 0, down: 0 } as const, angle: job.watermarkAngle, share: WATERMARK_SHARE, opacity: WATERMARK_OPACITY };
    pages = pages.map((page, index) => withMarks(page, [watermarkOn(page, sample, options, tools.scaled, `batch-watermark-${index}`)]));
  }
  if (has(job, 'numbers')) {
    const numbering: PageNumbering = { ...DEFAULT_NUMBERING, format: job.numberFormat === 'custom' ? 'plain' : job.numberFormat, place: job.numberPlace };
    pages = pages.map((page, index) => {
      const text = numberOfPage(numbering, index, pages.length, words);
      return text === null ? page : { ...page, marks: [...(page.marks ?? []), numberMark(page, text, numbering, fitted, `batch-number-${index}`)] };
    });
  }
  return pages;
}

/** True when the job leaves the pages of a PDF exactly as they are in its file. */
export function leavesPagesAlone(job: BatchJob): boolean {
  return job.steps.every((step) => step === 'sign');
}

/** What the Rust side is told of a file already where a result goes: it takes its place, or it is left alone. */
export const overExisting = (replace: boolean) => (replace ? { replace: true } : { keepExisting: true });

/**
 * What the Rust side is asked for one result, besides its pages and where it
 * goes. Signing is asked for apart (`sign_document`), with these options too.
 * `replace` says whether a file already there is written over.
 */
export function writeRequest(job: BatchJob, replace: boolean): { command: 'save_pages' | 'export_document'; options: Record<string, unknown> } {
  if (has(job, 'export')) return { command: 'export_document', options: { ...exportRequest(job.choice), ...overExisting(replace) } };
  const options: Record<string, unknown> = overExisting(replace);
  if (has(job, 'compress')) options.shrinkPictures = COMPRESS_LEVELS[job.level];
  return { command: 'save_pages', options };
}
