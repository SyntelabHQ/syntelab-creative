import { applyTheme, resolveTheme, toneOf, watchSystemTheme } from '@syntelab/ui-kit';
import type { ThemePreference } from '@syntelab/ui-kit';
import { useEffect } from 'react';

/** Applies the chosen theme and follows the system while it is "automatic". */
export function useAppliedTheme(preference: ThemePreference): void {
  useEffect(
    () => watchSystemTheme((systemPrefersDark) => applyTheme(resolveTheme(preference, systemPrefersDark), toneOf(preference))),
    [preference],
  );
}
