import type { AppHost } from '@syntelab/shell-api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { filesOf, receiveFiles } from './received-files';
import type { Received } from './received-files';

/**
 * Lets the tab in front take files that are dropped on the window or pasted
 * (Ctrl+V). `onFiles` gets where the Rust side keeps their copies. Returns
 * true while files are held over the window, to show where they will land.
 */
export function useReceivedFiles(host: AppHost, onFiles: (received: Received) => void): boolean {
  const { invoke } = host;
  const latest = useRef(onFiles);
  latest.current = onFiles;
  const take = useCallback((files: File[]) => void receiveFiles({ invoke }, files).then((received) => latest.current(received)), [invoke]);
  return useDroppedFiles(host, take);
}

/**
 * Lets the tab in front take files that are dropped on the window or pasted
 * (Ctrl+V), as they come. A drop a part of the tab took itself (its
 * `preventDefault` called first, as the pages do when files are dropped among
 * them) is left to it. Returns true while files are held over the window
 * outside such a part, to show where they will land.
 */
export function useDroppedFiles(host: AppHost, onFiles: (files: File[]) => void): boolean {
  const [over, setOver] = useState(false);
  const { active } = host;
  const latest = useRef(onFiles);
  latest.current = onFiles;

  useEffect(() => {
    if (!active) return;
    // Only files from outside count; pages and cards moved inside the program carry none.
    const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
    const take = (files: File[]) => {
      if (files.length > 0) latest.current(files);
    };
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
      // Over a part that takes the files itself, its own sign shows where they go.
      setOver(!event.defaultPrevented);
      // Without this the window would open the file itself, in place of the program.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      const taken = event.defaultPrevented;
      event.preventDefault();
      depth = 0;
      setOver(false);
      if (!taken) take(filesOf(event.dataTransfer));
    };
    const onPaste = (event: ClipboardEvent) => {
      // Text pasted into a field is the field's business.
      const files = filesOf(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      take(files);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
      setOver(false);
    };
  }, [active]);

  return over;
}
