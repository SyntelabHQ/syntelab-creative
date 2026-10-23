import type { AppHost } from '@syntelab/shell-api';
import { useEffect, useState } from 'react';

/**
 * The fonts text can be written in: three that every PDF reader has, and the
 * fonts installed on this computer (read by the Rust side). Nothing ships
 * with the program; a font of the computer is put into the file that uses it.
 */

const NO_FONTS: readonly string[] = [];
let families: readonly string[] | null = null;
let loading: Promise<readonly string[]> | null = null;

/** The names of the fonts installed on the computer, sorted. Asked once. */
function loadFontFamilies(host: Pick<AppHost, 'invoke'>): Promise<readonly string[]> {
  loading ??= host
    .invoke<{ families: string[] }>('list_fonts')
    .then((answer) => (families = answer.families))
    // Where they cannot be listed, the built-in fonts are all there is.
    .catch(() => (families = NO_FONTS));
  return loading;
}

/** The fonts of the computer; empty until they are known. */
export function useFontFamilies(host: Pick<AppHost, 'invoke'>): readonly string[] {
  const [known, setKnown] = useState(families ?? NO_FONTS);
  const { invoke } = host;
  useEffect(() => {
    let cancelled = false;
    void loadFontFamilies({ invoke }).then((loaded) => !cancelled && setKnown(loaded));
    return () => {
      cancelled = true;
    };
  }, [invoke]);
  return known;
}
