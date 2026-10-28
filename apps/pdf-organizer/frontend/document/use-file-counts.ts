import type { AppHost } from '@syntelab/shell-api';
import { useEffect, useState } from 'react';

/**
 * What the signatures of a file say, all together, from the check made on this
 * computer (nothing is asked online):
 * - `valid`: each is intact, nothing but other signatures came after it, and its certificate is trusted;
 * - `unconfirmed`: each is intact, but a certificate is not trusted here (unknown, expired, made by its signer);
 * - `added`: each is intact, but something other than a signature was added to the file after one of them;
 * - `invalid`: what one of them signed was changed, or it is damaged.
 */
export type SignaturesVerdict = 'valid' | 'unconfirmed' | 'added' | 'invalid';

/** How the `signatures` command describes one signature (or time stamp), as far as the verdict needs. */
export interface CheckedSignature {
  readonly intact: boolean;
  readonly wholeFile: boolean;
  readonly signedAfter: boolean;
  readonly trust: 'trusted' | 'expired' | 'untrusted' | 'unknown';
}

/** The worst of what the signatures say; null for a file without any. */
export function signaturesVerdict(signatures: readonly CheckedSignature[]): SignaturesVerdict | null {
  if (signatures.length === 0) return null;
  if (signatures.some((signature) => !signature.intact)) return 'invalid';
  if (signatures.some((signature) => !signature.wholeFile && !signature.signedAfter)) return 'added';
  if (signatures.some((signature) => signature.trust !== 'trusted')) return 'unconfirmed';
  return 'valid';
}

/** How many files the document's file has attached, how many signatures with a certificate, and what those say. */
export interface FileCounts {
  readonly attached: number;
  readonly signatures: number;
  /** Null without signatures, or while they are being checked. */
  readonly verdict: SignaturesVerdict | null;
}

const NONE: FileCounts = { attached: 0, signatures: 0, verdict: null };

/**
 * Counts what the document's file holds, for the numbers on the rail beside
 * the pages and the line over them about its signatures. Asked again when
 * `asked` changes (a dialog of attached files or signatures closed, the file
 * was saved); a question that fails counts none.
 */
export function useFileCounts(host: AppHost, documentId: number | undefined, asked: unknown): FileCounts {
  const [counts, setCounts] = useState<FileCounts>(NONE);
  const { invoke } = host;

  useEffect(() => {
    if (documentId === undefined) {
      setCounts(NONE);
      return;
    }
    let cancelled = false;
    const attached = invoke<{ files: unknown[] }>('attached_files', { documentId }).then(
      ({ files }) => files.length,
      () => 0,
    );
    const signatures = invoke<{ signatures: CheckedSignature[] }>('signatures', { documentId }).then(
      (answer) => answer.signatures,
      () => [],
    );
    void Promise.all([attached, signatures]).then(([attachedCount, checked]) => {
      if (!cancelled) setCounts({ attached: attachedCount, signatures: checked.length, verdict: signaturesVerdict(checked) });
    });
    return () => {
      cancelled = true;
    };
  }, [invoke, documentId, asked]);

  return counts;
}
