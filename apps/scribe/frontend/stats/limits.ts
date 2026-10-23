/**
 * The lengths texts are often held to, in characters: what fits in a short
 * post, a title, a description. Named by what they are for, not by where.
 */
export const LIMITS: readonly { readonly id: string; readonly characters: number }[] = [
  { id: 'title', characters: 60 },
  { id: 'videoTitle', characters: 100 },
  { id: 'profile', characters: 150 },
  { id: 'description', characters: 160 },
  { id: 'shortPost', characters: 280 },
  { id: 'pin', characters: 500 },
  { id: 'caption', characters: 2200 },
  { id: 'longPost', characters: 3000 },
];

/** How a text stands against a limit: how many characters are left (fewer than none when it is over), and how full it is, from 0 to 1. */
export function against(characters: number, limit: number): { readonly left: number; readonly full: number; readonly state: 'ok' | 'near' | 'over' } {
  const left = limit - characters;
  return { left, full: Math.min(characters / limit, 1), state: left < 0 ? 'over' : left < limit * 0.1 ? 'near' : 'ok' };
}
