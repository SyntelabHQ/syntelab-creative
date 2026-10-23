/**
 * The endings of files as the user typed them ("txt, .md; *.csv"), as a list
 * without dots, stars and repeats. Empty means every file that is text.
 */
export function endingsOf(typed: string): string[] {
  const endings = typed
    .split(/[\s,;]+/)
    .map((ending) => ending.replace(/^\*?\./, '').trim().toLowerCase())
    .filter((ending) => ending !== '' && ending !== '*');
  return [...new Set(endings)];
}
