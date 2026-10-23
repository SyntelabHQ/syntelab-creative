/** A text as it is looked for: in small letters, without the marks over and under them, so "angstrom" finds "ångström". */
export function plain(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/ø/gi, 'o').toLowerCase();
}
