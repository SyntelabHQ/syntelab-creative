import type { AppHost } from '@syntelab/shell-api';
import type { LoadedPicture } from '../document/load-picture';

/** What is kept, each kind in a list of its own. (Initials had a tool of their own once; their list is no longer added to.) */
export type SignatureKind = 'signature' | 'initials';
const KEYS: Record<SignatureKind, string> = { signature: 'signatures', initials: 'initials' };
/** More than this and the oldest is forgotten. */
export const MAX_SAVED_SIGNATURES = 6;

function isPicture(value: unknown): value is LoadedPicture {
  if (typeof value !== 'object' || value === null) return false;
  const { address, width, height } = value as Record<string, unknown>;
  return typeof address === 'string' && address.startsWith('data:image/') && typeof width === 'number' && typeof height === 'number';
}

/** The signatures kept on this computer, newest first. */
export function loadSignatures(host: Pick<AppHost, 'loadData'>, kind: SignatureKind = 'signature'): LoadedPicture[] {
  const stored = host.loadData<unknown>(KEYS[kind]);
  return Array.isArray(stored) ? stored.filter(isPicture).slice(0, MAX_SAVED_SIGNATURES) : [];
}

/** Puts a signature first in the list; one already there is not kept twice. */
export function withSignature(saved: readonly LoadedPicture[], signature: LoadedPicture): LoadedPicture[] {
  return [signature, ...saved.filter((known) => known.address !== signature.address)].slice(0, MAX_SAVED_SIGNATURES);
}

export function saveSignatures(
  host: Pick<AppHost, 'saveData'>,
  signatures: readonly LoadedPicture[],
  kind: SignatureKind = 'signature',
): void {
  host.saveData(KEYS[kind], signatures);
}
