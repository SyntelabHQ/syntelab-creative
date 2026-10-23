import type { AppHost } from '@syntelab/shell-api';
import { useEffect, useRef, useState } from 'react';
import { filesOf, receiveFiles } from './received-files';
import type { Received } from './received-files';

/**
 * Lets the tab in front take files that are dropped on the window or pasted
 * (Ctrl+V). `onFiles` gets where the Rust side keeps their copies. Returns
 * true while files are held over the window, to show where they will land.
 */
export function useReceivedFiles(host: AppHost, onFiles: (received: Received) => void): boolean {
  const [over, setOver] = useState(false);
  const { active, invoke } = host;
  const latest = useRef(onFiles);
  latest.current = onFiles;

  useEffect(() => {
    if (!active) return;
    // Only files from outside count; pages and cards moved inside the program carry none.
    const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
    const take = (files: File[]) => {
      if (files.length > 0) void receiveFiles({ invoke }, files).then((received) => latest.current(received));
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
      // Without this the window would open the file itself, in place of the program.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setOver(false);
      take(filesOf(event.dataTransfer));
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
  }, [active, invoke]);

  return over;
}
