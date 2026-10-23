import type { AppHost } from '@syntelab/shell-api';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { openNewTextTab, openTextInTab } from './open-text';
import type { OpenedText } from './text-file';

/**
 * Files dropped on the window. Where the window can say where they are on
 * disk, each opens as the file itself, as with File → Open: Save writes back
 * to it. Otherwise only their content is known, and a dropped file opens as a
 * new text with the file's name and form: saving it asks where.
 */

/** Larger files are not read this way: they are opened from where they are, with File → Open. */
const MAX_DROPPED_BYTES = 64 * 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  let text = '';
  // In stretches: one call per byte would be slow, one call for all overflows the stack.
  for (let start = 0; start < bytes.length; start += 0x8000) text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(text);
}

/** Opens each dropped file as a new text. Returns how many could not be opened (too large, not text). */
async function openDroppedFiles(host: Pick<AppHost, 'invoke' | 'openTab'>, files: readonly File[]): Promise<number> {
  let skipped = 0;
  for (const file of files) {
    if (file.size > MAX_DROPPED_BYTES) {
      skipped += 1;
      continue;
    }
    try {
      const data = toBase64(new Uint8Array(await file.arrayBuffer()));
      const read = await host.invoke<OpenedText>('read_bytes', { data });
      openNewTextTab(host, file.name || '{number}', read.text, { name: file.name, form: { encoding: read.encoding, mark: read.mark, lineEnding: read.lineEnding } });
    } catch {
      skipped += 1;
    }
  }
  return skipped;
}

/** Opens dropped files: by their paths when the window gives them, else by their content. */
async function openDropped(host: Pick<AppHost, 'invoke' | 'openTab' | 'pathsOfDropped'>, files: readonly File[]): Promise<number> {
  const paths = await host.pathsOfDropped(files).catch(() => null);
  if (paths === null) return openDroppedFiles(host, files);
  for (const path of paths) openTextInTab(host, path);
  return 0;
}

// How many files of the last drop could not be opened. Shared by the tabs: the files that did open
// are in front by then, and it is there that the rest must be accounted for.
let skippedLast = 0;
const listeners = new Set<() => void>();
function setSkipped(count: number): void {
  skippedLast = count;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Lets the tab in front take files that are dropped on the window. Returns
 * whether files are held over the window (to show where they will land) and
 * how many of the last drop could not be opened.
 */
export function useDroppedFiles(host: Pick<AppHost, 'invoke' | 'openTab' | 'pathsOfDropped' | 'active'>): { readonly over: boolean; readonly skipped: number; readonly forget: () => void } {
  const [over, setOver] = useState(false);
  const skipped = useSyncExternalStore(subscribe, () => skippedLast);
  const { active } = host;
  const latest = useRef(host);
  latest.current = host;

  useEffect(() => {
    if (!active) return;
    // Only files from outside count: text dragged inside the editor carries none.
    const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
    let depth = 0;
    const onDragEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth += 1;
      setOver(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(depth - 1, 0);
      if (depth === 0) setOver(false);
    };
    const onDragOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      // Without this the window would show the file itself, in place of the program.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      // The editor is not to take the drop as text of its own.
      event.stopPropagation();
      depth = 0;
      setOver(false);
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length > 0) void openDropped(latest.current, files).then(setSkipped);
    };
    // Before the editor hears of them: it would put the file's name in the text.
    window.addEventListener('dragenter', onDragEnter, true);
    window.addEventListener('dragleave', onDragLeave, true);
    window.addEventListener('dragover', onDragOver, true);
    window.addEventListener('drop', onDrop, true);
    return () => {
      window.removeEventListener('dragenter', onDragEnter, true);
      window.removeEventListener('dragleave', onDragLeave, true);
      window.removeEventListener('dragover', onDragOver, true);
      window.removeEventListener('drop', onDrop, true);
      setOver(false);
    };
  }, [active]);

  return { over, skipped, forget: () => setSkipped(0) };
}
