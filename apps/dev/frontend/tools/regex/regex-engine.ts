/** What is asked of a regular expression: a pattern, its flags, the text it is tried on, and what its matches are replaced with (null to list them). */
export interface RegexRequest {
  readonly pattern: string;
  /** Any of `g i m s u y`, in any order. */
  readonly flags: string;
  readonly text: string;
  readonly replacement: string | null;
}

/** One place the pattern matched. */
export interface RegexMatch {
  /** Where it begins and ends in the text, counted as JavaScript counts (in UTF-16 units). */
  readonly index: number;
  readonly end: number;
  /** Its line and column, from 1. */
  readonly line: number;
  readonly column: number;
  readonly match: string;
  /** The numbered groups, from the first; null for one that took no part. */
  readonly groups: readonly (string | null)[];
  /** The named groups, when the pattern has any. */
  readonly named?: Readonly<Record<string, string | null>>;
}

export type RegexAnswer = { readonly ok: true; readonly matches: readonly RegexMatch[]; readonly replaced: string | null } | { readonly ok: false; readonly detail: string };

/**
 * Tries a regular expression of JavaScript on a text: every place it
 * matches, with its groups, or the text with the matches replaced. The
 * engine is the one of the browser the program draws with, so what matches
 * here is what matches in JavaScript; a pattern it does not take is told in
 * its own words.
 *
 * Without the `g` flag only the first match is looked for, as in
 * JavaScript. A pattern that matches nothing at a place moves on by one
 * letter (a whole letter beyond the first plane with `u`, as `matchAll`
 * does), so it never stands still.
 */
export function runRegex({ pattern, flags, text, replacement }: RegexRequest): RegexAnswer {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
  if (replacement !== null) return { ok: true, matches: [], replaced: text.replace(regex, replacement) };

  const matches: RegexMatch[] = [];
  // Lines are counted as the matches are met: they come in order, so the text is walked once.
  let line = 1;
  let lineStart = 0;
  let counted = 0;
  const place = (index: number) => {
    for (let at = text.indexOf('\n', counted); at !== -1 && at < index; at = text.indexOf('\n', at + 1)) {
      line += 1;
      lineStart = at + 1;
      counted = at + 1;
    }
    return { line, column: index - lineStart + 1 };
  };
  const take = (found: RegExpExecArray) => {
    const named = found.groups ? Object.fromEntries(Object.entries(found.groups).map(([name, value]) => [name, value ?? null])) : undefined;
    matches.push({ index: found.index, end: found.index + found[0].length, ...place(found.index), match: found[0], groups: found.slice(1).map((group) => group ?? null), ...(named ? { named } : {}) });
  };
  if (!regex.global && !regex.sticky) {
    const found = regex.exec(text);
    if (found) take(found);
  } else {
    for (let found = regex.exec(text); found !== null; found = regex.exec(text)) {
      take(found);
      // Past an empty match by one letter: with `u` a letter beyond the first plane is two units, and the engine
      // would go back to its start and match there again for ever.
      if (found[0] === '') regex.lastIndex += regex.unicode && (text.codePointAt(regex.lastIndex) ?? 0) > 0xffff ? 2 : 1;
      if (!regex.global) break;
    }
  }
  return { ok: true, matches, replaced: null };
}
