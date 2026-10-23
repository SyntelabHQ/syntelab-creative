/**
 * A text handed to the tool that is about to open (what was pasted on the
 * first page). It is held in memory only, for the moment between the click
 * and the tool being made: the tool takes it, and it is gone.
 */
let handed: string | null = null;

/** Hands a text to the next tool that opens. */
export function hand(text: string): void {
  handed = text;
}

/** The text that was handed over, once: taking it leaves nothing behind. */
export function takeHanded(): string | null {
  const text = handed;
  handed = null;
  return text;
}
