import { normalize } from '@syntelab/command-registry';

/**
 * The manual, as its files have it: `help/shell/<lang>.json` for the program
 * as a whole, `apps/<app-id>/help/<lang>.json` for each app. A manual is a
 * book of chapters, a chapter a list of topics, a topic a few blocks of text.
 */

/** The id of the program's own manual; the others carry the id of their app. */
export const SHELL_MANUAL = 'shell';

/** One block of a topic: a paragraph, steps to follow in order, a list of points, or a note set apart. */
export type ManualBlock = string | { readonly steps: readonly string[] } | { readonly points: readonly string[] } | { readonly note: string };

export interface ManualTopic {
  /** Unique in its manual; a topic is opened by `<manual id>/<topic id>`. */
  readonly id: string;
  readonly title: string;
  readonly body: readonly ManualBlock[];
}

export interface ManualChapter {
  readonly title: string;
  /** The chapter says what the program or the app is, what it is built with and what it cannot do yet; Help shows these together, under "About". */
  readonly about?: boolean;
  readonly topics: readonly ManualTopic[];
}

export interface Manual {
  /** `shell`, or the id of the app the manual is of. */
  readonly id: string;
  readonly title: string;
  readonly chapters: readonly ManualChapter[];
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const isTexts = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every(isText);

function readBlock(value: unknown): ManualBlock | null {
  if (isText(value)) return value;
  if (typeof value !== 'object' || value === null) return null;
  const block = value as Record<string, unknown>;
  if (isTexts(block.steps)) return { steps: block.steps };
  if (isTexts(block.points)) return { points: block.points };
  return isText(block.note) ? { note: block.note } : null;
}

/** A manual read from its file. Anything malformed in it is left out; null when nothing usable is left. */
export function parseManual(id: string, file: unknown): Manual | null {
  if (typeof file !== 'object' || file === null) return null;
  const { title, chapters } = file as { title?: unknown; chapters?: unknown };
  if (!isText(title) || !Array.isArray(chapters)) return null;
  const read: ManualChapter[] = [];
  for (const chapter of chapters as { title?: unknown; topics?: unknown; about?: unknown }[]) {
    if (typeof chapter !== 'object' || chapter === null || !isText(chapter.title) || !Array.isArray(chapter.topics)) continue;
    const topics: ManualTopic[] = [];
    for (const topic of chapter.topics as { id?: unknown; title?: unknown; body?: unknown }[]) {
      if (typeof topic !== 'object' || topic === null || !isText(topic.id) || !isText(topic.title) || !Array.isArray(topic.body)) continue;
      const body = topic.body.map(readBlock).filter((block): block is ManualBlock => block !== null);
      if (body.length > 0 && !topics.some((known) => known.id === topic.id)) topics.push({ id: topic.id, title: topic.title, body });
    }
    if (topics.length > 0) read.push(chapter.about === true ? { title: chapter.title, about: true, topics } : { title: chapter.title, topics });
  }
  return read.length > 0 ? { id, title, chapters: read } : null;
}

/** Everything a block says, as plain text. */
function blockText(block: ManualBlock): string {
  if (typeof block === 'string') return block;
  if ('steps' in block) return block.steps.join(' ');
  return 'points' in block ? block.points.join(' ') : block.note;
}

/** A topic found by a search, with the manual and the chapter it is in. */
export interface FoundTopic {
  readonly manual: Manual;
  readonly chapter: ManualChapter;
  readonly topic: ManualTopic;
}

/**
 * The topics that have every word typed, in their title or their text; those
 * with a word in the title come first. An empty search finds nothing.
 */
export function searchManuals(manuals: readonly Manual[], query: string): FoundTopic[] {
  const words = normalize(query).split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return [];
  const found: { hit: FoundTopic; inTitle: boolean }[] = [];
  for (const manual of manuals) {
    for (const chapter of manual.chapters) {
      for (const topic of chapter.topics) {
        const title = normalize(topic.title);
        const text = `${title} ${normalize(topic.body.map(blockText).join(' '))}`;
        if (words.every((word) => text.includes(word))) found.push({ hit: { manual, chapter, topic }, inTitle: words.some((word) => title.includes(word)) });
      }
    }
  }
  return [...found.filter((one) => one.inTitle), ...found.filter((one) => !one.inTitle)].map((one) => one.hit);
}
