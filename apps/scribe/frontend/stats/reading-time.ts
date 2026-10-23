/** Words a minute of an adult reading in silence, and of someone speaking to be followed. */
export const READING_WORDS_A_MINUTE = 230;
export const SPEAKING_WORDS_A_MINUTE = 140;

/** Words a minute of someone typing, and of someone writing by hand. */
export const TYPING_WORDS_A_MINUTE = 40;
export const HANDWRITING_WORDS_A_MINUTE = 13;

/** How long so many words take at so many words a minute, in minutes. */
export function minutesAt(words: number, wordsAMinute: number): number {
  return wordsAMinute > 0 ? words / wordsAMinute : 0;
}

export function readingMinutes(words: number): number {
  return words / READING_WORDS_A_MINUTE;
}

export function speakingMinutes(words: number): number {
  return words / SPEAKING_WORDS_A_MINUTE;
}

/** A length of time in minutes, as whole hours, minutes and seconds (seconds rounded; none shown from an hour up). */
export function timeParts(minutes: number): { readonly hours: number; readonly minutes: number; readonly seconds: number } {
  const total = Math.max(Math.round(minutes * 60), 0);
  const hours = Math.floor(total / 3600);
  // From an hour up the seconds do not matter: they round into the minutes.
  if (hours > 0) {
    const rounded = Math.round(total / 60);
    return { hours: Math.floor(rounded / 60), minutes: rounded % 60, seconds: 0 };
  }
  return { hours: 0, minutes: Math.floor(total / 60), seconds: total % 60 };
}
