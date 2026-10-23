import { AppInvokeError, fileName } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';
import { useRef, useState } from 'react';
import { planFromDocument, planRequest } from '../document/page-plan';
import type { PlanPage } from '../document/page-plan';
import { openAsPages, pageSourceProblem } from '../document/page-sources';
import type { OpenedDocument } from '../document/use-document';
import { markRequest } from '../marks/mark';
import { hasText, hiddenTextMark } from '../ocr/ocr-words';
import type { ReadWord } from '../ocr/ocr-words';
import type { SigningCertificate } from '../sign/certificate-picker';
import { presetLines } from '../sign/signature-presets';
import type { SignaturePreset, SignatureWords } from '../sign/signature-presets';
import { has, inFolder, leavesPagesAlone, oneName, overExisting, pagesAfter, resultEnding, resultNames, resultPaths, writeRequest } from './batch-actions';
import type { BatchJob, BatchOutput, PageTools } from './batch-actions';
import { signaturePlaces } from './sign-settings';
import type { SignPages, SignSpot } from './sign-settings';

/** How one file went. */
export type Outcome = { readonly state: 'waiting' } | { readonly state: 'working' } | { readonly state: 'done'; readonly name: string } | { readonly state: 'failed'; readonly problem: string };

export const WAITING: Outcome = { state: 'waiting' };

/** How the files are signed, when signing is one of the things done to them. */
export interface BatchSigning extends SigningCertificate {
  readonly reason: string;
  readonly location: string;
  readonly lock: boolean;
  /** The time-stamping authority each signature gets a time stamp from; null: none. */
  readonly timeStamp: string | null;
  /** The pages of each file the signature shows on, and where on them. */
  readonly pages: SignPages;
  readonly spot: SignSpot;
  readonly preset: SignaturePreset;
  /** The moment written in the signature's look, already in the language of the program. */
  readonly moment: string;
  readonly words: SignatureWords;
}

/** Everything one run needs to know. */
export interface BatchRequest {
  readonly files: readonly string[];
  /** For the files whose result goes into a folder under the chosen one: that folder, by the file's path. */
  readonly under: ReadonlyMap<string, string>;
  readonly job: BatchJob;
  readonly output: BatchOutput;
  readonly folder: string;
  /** What is added to each file's name. */
  readonly suffix: string;
  /** The name of the one file, when everything is gathered in one. */
  readonly oneName: string;
  /** Whether a result takes the place of a file already where it goes (the user said so); otherwise that file is left alone. */
  readonly replace: boolean;
  /** Present when signing is one of the steps. */
  readonly signing: BatchSigning | null;
  /** What pages are drawn on with; the file is filled in for each. */
  readonly tools: Omit<PageTools, 'file'>;
}

/** How a run ended. */
export interface BatchResult {
  /** Where the first result was written: the file to show in its folder. Null when nothing was written. */
  readonly first: string | null;
  readonly outcomes: ReadonlyMap<string, Outcome>;
}

export interface BatchRun {
  readonly outcomes: ReadonlyMap<string, Outcome>;
  readonly running: boolean;
  /** Where the first result of the last run was written. */
  readonly firstResult: string | null;
  /** Why the whole run was given up, as a key of the translations. */
  readonly problem: string | null;
  readonly start: (request: BatchRequest) => Promise<BatchResult>;
  /** Stops after the file that is being worked on. */
  readonly stop: () => void;
  readonly clear: () => void;
}

/** Problems that are the same for every file: going on would only repeat them. */
const ENDS_THE_RUN: Record<string, string | null> = {
  'sign-cancelled': null,
  'wrong-password': 'pdf-organizer.sign.wrongPassword',
  'no-certificate': 'pdf-organizer.sign.noCertificate',
  'certificates-unsupported': 'pdf-organizer.sign.unsupported',
  // The authority is the same for every file: when it cannot be reached, it cannot for the next one either.
  'time-stamp-failed': 'pdf-organizer.timestamp.failed',
  'time-stamp-address': 'pdf-organizer.timestamp.wrongAddress',
  'no-ocr-engine': 'pdf-organizer.ocr.failed',
};

const codeOf = (error: unknown): string => (error instanceof AppInvokeError ? (error.code ?? '') : '');

function problemOf(error: unknown): string {
  const code = codeOf(error);
  if (code === 'destination-exists') return 'pdf-organizer.batch.exists';
  if (code === 'destination-in-use') return 'pdf-organizer.batch.sameFile';
  if (code === 'destination-busy') return 'pdf-organizer.batch.notReplaced';
  if (code === 'document-locked') return 'pdf-organizer.sign.locked';
  if (code === 'needs-office' || code === 'office-timed-out') return pageSourceProblem(error);
  if (code.startsWith('ocr')) return 'pdf-organizer.ocr.failed';
  return 'pdf-organizer.batch.failed';
}

/** What the Rust side is asked to sign with, and what shows of the signature on the pages it goes on. */
function signRequest(signing: BatchSigning, pages: readonly PlanPage[], tools: Pick<PageTools, 'fitted'>, replace: boolean): Record<string, unknown> {
  const { certificate, reason, location, lock, timeStamp } = signing;
  const common = { certificate, reason, location, lock, timeStamp, ...overExisting(replace) };
  const lines = presetLines(signing.preset, { signer: signing.signer, moment: signing.moment, reason, location }, signing.words);
  const places = signaturePlaces(signing, pages, signing.preset.picture, lines, tools.fitted).map(({ page, box, look }) => ({ page, ...box, look: look.map(markRequest) }));
  // One page: the usual request. Several: the same signature, with a box on each of them.
  const [only] = places;
  if (places.length === 1 && only) {
    const { look, ...place } = only;
    return { ...common, place, look };
  }
  return places.length === 0 ? common : { ...common, places };
}

/**
 * A run of batch processing: the files one after another, each with how it
 * went. A result takes the place of a file that is already there (even of the
 * file itself) only when the request says so, and then only once it is whole.
 */
export function useBatchRun(host: Pick<AppHost, 'invoke'>): BatchRun {
  const { invoke } = host;
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, Outcome>>(new Map());
  const [running, setRunning] = useState(false);
  const [firstResult, setFirstResult] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const stopping = useRef(false);
  /** The outcomes as they are this moment: what the run hands back when it ends. */
  const latest = useRef(new Map<string, Outcome>());

  const set = (path: string, outcome: Outcome) => {
    latest.current.set(path, outcome);
    setOutcomes(new Map(latest.current));
  };
  const close = (opened: OpenedDocument) => void invoke('close_document', { documentId: opened.documentId }).catch(() => {});

  /** Reads the scanned pages among `pages` and writes their words into them, unseen. Pages that have text are left as they are. */
  const read = async (job: BatchJob, pages: readonly PlanPage[]): Promise<PlanPage[]> => {
    const done: PlanPage[] = [];
    for (const [index, page] of pages.entries()) {
      const ownText = await invoke<{ texts: string[] }>('page_texts', { documentId: page.documentId, fromPage: page.page, pageCount: 1 }).then(
        (answer) => answer.texts[0] ?? '',
        () => '',
      );
      if (hasText(ownText)) {
        done.push(page);
        continue;
      }
      const { words } = await invoke<{ words: ReadWord[] }>('ocr_page', { documentId: page.documentId, page: page.page, rotation: page.rotation, languages: job.ocrLanguages });
      done.push(words.length === 0 ? page : { ...page, marks: [...(page.marks ?? []), hiddenTextMark(page, words, `batch-read-${index}`)] });
    }
    return done;
  };

  /** The pages of opened files as the job leaves them. */
  const prepared = async (request: BatchRequest, plan: readonly PlanPage[], file: string): Promise<PlanPage[]> => {
    const pages = pagesAfter(request.job, plan, { ...request.tools, file });
    return has(request.job, 'ocr') ? read(request.job, pages) : pages;
  };

  /** Writes one result from pages that are open; `asItIs` says they are a PDF's own pages, untouched. */
  const write = async (request: BatchRequest, destination: string, baseDocumentId: number, pages: readonly PlanPage[], asItIs: boolean) => {
    const { job, signing, replace } = request;
    if (has(job, 'sign') && signing) {
      // A PDF that is only signed is added to, so the signatures it has stay good; anything else is written anew, then signed.
      const whole = asItIs ? {} : { pages: planRequest(pages), ...writeRequest(job, replace).options };
      await invoke('sign_document', { destination, baseDocumentId, ...whole, ...signRequest(signing, pages, request.tools, replace) });
      return;
    }
    const { command, options } = writeRequest(job, replace);
    await invoke(command, { destination, baseDocumentId, pages: planRequest(pages), ...options });
  };

  /** A result for each file. Answers with where the first one was written. */
  const each = async (request: BatchRequest): Promise<string | null> => {
    const names = resultNames(request.files, request.suffix, resultEnding(request.job));
    const destinations = resultPaths(request.files, request.under, request.folder, names);
    let first: string | null = null;
    for (const [index, path] of request.files.entries()) {
      if (stopping.current) break;
      set(path, { state: 'working' });
      const name = names[index] ?? '';
      const under = request.under.get(path) ?? '';
      const destination = destinations[index] ?? '';
      let opened: OpenedDocument | null = null;
      try {
        if (under !== '') await invoke('make_folder', { path: inFolder(request.folder, under) });
        opened = await openAsPages({ invoke }, path);
        const pages = await prepared(request, planFromDocument(opened.documentId, opened.pageSizes), fileName(path));
        await write(request, destination, opened.documentId, pages, /\.pdf$/i.test(path) && leavesPagesAlone(request.job));
        set(path, { state: 'done', name: under === '' ? name : `${under}/${name}` });
        first ??= destination;
      } catch (error) {
        const code = codeOf(error);
        if (code in ENDS_THE_RUN) {
          set(path, WAITING);
          setProblem(ENDS_THE_RUN[code] ?? null);
          break;
        }
        set(path, { state: 'failed', problem: problemOf(error) });
      } finally {
        if (opened) close(opened);
      }
    }
    return first;
  };

  /** Every file's pages gathered in one PDF, in the order of the list. A file that cannot be read is left out. */
  const one = async (request: BatchRequest): Promise<string | null> => {
    const name = oneName(request.oneName);
    const destination = inFolder(request.folder, name);
    const opened: { path: string; document: OpenedDocument }[] = [];
    try {
      for (const path of request.files) {
        if (stopping.current) return null;
        set(path, { state: 'working' });
        try {
          opened.push({ path, document: await openAsPages({ invoke }, path) });
          set(path, WAITING);
        } catch (error) {
          set(path, { state: 'failed', problem: problemOf(error) });
        }
      }
      const base = opened[0];
      if (!base) return null;
      for (const { path } of opened) set(path, { state: 'working' });
      const gathered = opened.flatMap(({ document }) => planFromDocument(document.documentId, document.pageSizes));
      try {
        await write(request, destination, base.document.documentId, await prepared(request, gathered, name), false);
      } catch (error) {
        const code = codeOf(error);
        if (code in ENDS_THE_RUN) setProblem(ENDS_THE_RUN[code] ?? null);
        for (const { path } of opened) set(path, code in ENDS_THE_RUN ? WAITING : { state: 'failed', problem: problemOf(error) });
        return null;
      }
      for (const { path } of opened) set(path, { state: 'done', name });
      return destination;
    } finally {
      for (const { document } of opened) close(document);
    }
  };

  return {
    outcomes,
    running,
    firstResult,
    problem,
    start: async (request) => {
      stopping.current = false;
      setRunning(true);
      setProblem(null);
      setFirstResult(null);
      latest.current = new Map(request.files.map((path) => [path, WAITING]));
      setOutcomes(new Map(latest.current));
      try {
        const first = await (request.output === 'one' ? one(request) : each(request));
        setFirstResult(first);
        return { first, outcomes: new Map(latest.current) };
      } finally {
        setRunning(false);
      }
    },
    stop: () => {
      stopping.current = true;
    },
    clear: () => {
      latest.current = new Map();
      setOutcomes(new Map());
      setProblem(null);
      setFirstResult(null);
    },
  };
}
