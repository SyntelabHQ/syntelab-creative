import { useTranslation } from '@syntelab/i18n';
import { AppInvokeError } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';
import { useCallback, useEffect } from 'react';
import { loadPicture } from '../document/load-picture';
import type { LoadedPicture } from '../document/load-picture';
import { PICTURE_TYPES } from '../document/page-sources';
import type { Placing } from '../marks/placing';
import { SignatureDialog } from './signature-dialog';

/** The tools that choose something to put on a page: an image, a signature. */
export type InsertTool = 'image' | 'signature';

export interface InsertToolsProps {
  readonly host: AppHost;
  /** The tool in use, or null. */
  readonly tool: InsertTool | null;
  readonly onClose: () => void;
  /** It was chosen: the user then drags on a page where it goes and how large (see `marks/placing.ts`). */
  readonly onPlace: (placing: Placing) => void;
  /** Shows a problem to the user, by its translation key. */
  readonly onProblem: (key: string) => void;
  /** The fonts installed on the computer, for a typed signature. */
  readonly fonts: readonly string[];
}

/**
 * Choosing what "Add image" and "Add signature" put on the page: a picture
 * file, or a signature drawn, typed or kept from before. Where it goes is
 * decided on the page itself afterwards (see `marks/`).
 */
export function InsertTools({ host, tool, onClose, onPlace, onProblem, fonts }: InsertToolsProps) {
  const t = useTranslation();
  const { invoke, pickFiles } = host;

  const pickPicture = useCallback(async (): Promise<LoadedPicture | null> => {
    const [path] = await pickFiles({ typeName: t('pdf-organizer.place.pictureType'), extensions: [...PICTURE_TYPES] });
    if (!path) return null;
    try {
      return await loadPicture({ invoke }, path);
    } catch (error) {
      const tooLarge = error instanceof AppInvokeError && error.code === 'picture-too-large';
      onProblem(tooLarge ? 'pdf-organizer.error.pictureTooLarge' : 'pdf-organizer.error.notAPicture');
      return null;
    }
  }, [invoke, pickFiles, onProblem, t]);

  // "Add image" asks for the file at once; without one there is nothing to place.
  useEffect(() => {
    if (tool !== 'image') return;
    let cancelled = false;
    void pickPicture().then((picked) => {
      if (cancelled) return;
      if (picked) onPlace({ kind: 'picture', data: picked.address, width: picked.width, height: picked.height });
      onClose();
    });
    return () => {
      cancelled = true;
    };
    // Runs when the tool is chosen, not when its helpers are rebuilt.
  }, [tool]);

  return (
    <SignatureDialog
      host={host}
      open={tool === 'signature'}
      onClose={onClose}
      onPickPicture={pickPicture}
      fonts={fonts}
      onChoose={(placing) => {
        onPlace(placing);
        onClose();
      }}
    />
  );
}
