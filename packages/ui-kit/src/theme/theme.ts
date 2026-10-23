export const THEME_PREFERENCES = ['light', 'light-gray', 'dark-gray', 'dark', 'auto'] as const;

/** What the user chose. `auto` follows the system. */
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** Light or dark: what styles that differ between the two ask about. */
export type ResolvedTheme = 'light' | 'dark';
/** The shade of a theme: as light (or dark) as it gets, or a step toward gray. */
export type ThemeTone = 'plain' | 'gray';

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'auto') return systemPrefersDark ? 'dark' : 'light';
  return preference === 'dark' || preference === 'dark-gray' ? 'dark' : 'light';
}

export function toneOf(preference: ThemePreference): ThemeTone {
  return preference === 'light-gray' || preference === 'dark-gray' ? 'gray' : 'plain';
}

/** Switches the design tokens in `styles/tokens.css`. */
export function applyTheme(theme: ResolvedTheme, tone: ThemeTone = 'plain', root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme;
  root.dataset.tone = tone;
}

/**
 * Calls `onChange` now and whenever the system switches between light and
 * dark. Returns a function that stops watching.
 */
export function watchSystemTheme(onChange: (systemPrefersDark: boolean) => void): () => void {
  const query = window.matchMedia(SYSTEM_DARK_QUERY);
  const listener = () => onChange(query.matches);
  listener();
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
