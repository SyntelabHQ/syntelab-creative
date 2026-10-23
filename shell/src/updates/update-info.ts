import type { LocalizedText } from '@syntelab/shell-api';

/** The page a newer version is downloaded from when the file names none. */
export const DOWNLOAD_PAGE = 'https://syntelab.com/creative/download';

/** The only site a download page may be on. */
const SITES = ['https://syntelab.com/'];

/** What `remote/creative/check/update.json` says about the newest version. */
export interface UpdateInfo {
  /** The newest version that can be downloaded, like `1.4.0`. */
  readonly latest: string;
  /** `YYYY-MM-DD`, when given. */
  readonly date?: string;
  /** The page to download it from; always on a site of Syntelab. */
  readonly download: string;
  /** A few words on what is new, per language. */
  readonly notes?: LocalizedText;
}

function isText(value: unknown): value is LocalizedText {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((text) => typeof text === 'string')
  );
}

function isVersion(value: unknown): value is string {
  return typeof value === 'string' && /^v?\d+(\.\d+)*/.test(value);
}

/**
 * Reads an update file. Returns null when it does not name a version.
 *
 * The file is also the one the updater of Tauri reads, so its own fields come
 * first: `version` (the program's), `pub_date`, and `notes` as one English
 * text. The notes in every language are in `notes_by_language`. The fields of
 * the first files (`latest`, `date`, `notes` per language) are still read.
 */
export function parseUpdateInfo(file: unknown): UpdateInfo | null {
  if (typeof file !== 'object' || file === null) return null;
  const fields = file as Record<string, unknown>;
  const latest = isVersion(fields.version) ? fields.version : fields.latest;
  if (!isVersion(latest)) return null;
  const date =
    typeof fields.pub_date === 'string' ? fields.pub_date.slice(0, 10) : typeof fields.date === 'string' ? fields.date : undefined;
  const notes = isText(fields.notes_by_language)
    ? fields.notes_by_language
    : isText(fields.notes)
      ? fields.notes
      : typeof fields.notes === 'string'
        ? { en: fields.notes }
        : undefined;
  const { download } = fields;
  return {
    latest,
    date,
    // A download address anywhere else is not trusted.
    download: typeof download === 'string' && SITES.some((site) => download.startsWith(site)) ? download : DOWNLOAD_PAGE,
    notes,
  };
}
