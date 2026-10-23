/** A token that was read, written out as a text: its header, its payload, and what its claims say. */

/** The claims the standard names (RFC 7519, section 4.1), in the order they are told of. */
export const REGISTERED = ['iss', 'sub', 'aud', 'exp', 'nbf', 'iat', 'jti'] as const;
/** The ones that are moments in time: seconds since 1970. */
const MOMENTS = new Set(['exp', 'nbf', 'iat', 'auth_time', 'updated_at']);

export interface Claim {
  readonly name: string;
  /** As it is written in the token. */
  readonly value: string;
  /** For a moment in time: the date it stands for, written the same everywhere (`2026-10-11T18:00:00.000Z`). */
  readonly date?: string;
  /** For `exp` and `nbf`: whether that moment is past. */
  readonly past?: boolean;
}

/** The claims of a payload that are worth saying in words: those the standard names, and every moment in time. */
export function claimsOf(payload: string, now: number = Date.now()): Claim[] {
  let read: unknown;
  try {
    read = JSON.parse(payload);
  } catch {
    return [];
  }
  if (typeof read !== 'object' || read === null) return [];
  const all = read as Record<string, unknown>;
  const names = [...REGISTERED.filter((name) => name in all), ...Object.keys(all).filter((name) => MOMENTS.has(name) && !REGISTERED.includes(name as (typeof REGISTERED)[number]))];
  return names.map((name) => {
    const value = all[name];
    const written = typeof value === 'string' ? value : JSON.stringify(value);
    // A moment is a number of seconds; one too large to be a date is left as the number it is.
    if (!MOMENTS.has(name) || typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 8.64e12) return { name, value: written };
    const moment = value * 1000;
    return { name, value: written, date: new Date(moment).toISOString(), past: moment <= now };
  });
}

export interface ReportTexts {
  readonly header: string;
  readonly payload: string;
  readonly claims: string;
  /** The name of a claim in words (`Expires`), or the claim itself when it has none. */
  readonly claim: (name: string) => string;
  /** What is said after the date of `exp` and `nbf`: that it is past, or still to come. */
  readonly when: (name: string, past: boolean) => string;
}

/** The token as a text for the result pane: the header, the payload, then the claims in words. */
export function reportOf(header: string, payload: string, texts: ReportTexts, now: number = Date.now()): string {
  const claims = claimsOf(payload, now).map((claim) => {
    const said = claim.date === undefined ? claim.value : `${claim.date}${claim.past === undefined || !['exp', 'nbf'].includes(claim.name) ? '' : ` (${texts.when(claim.name, claim.past)})`}`;
    return `${claim.name}  ${texts.claim(claim.name)}: ${said}`;
  });
  const parts = [`${texts.header}\n${header}`, `${texts.payload}\n${payload}`];
  if (claims.length > 0) parts.push(`${texts.claims}\n${claims.join('\n')}`);
  return parts.join('\n\n');
}
