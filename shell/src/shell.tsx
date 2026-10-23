import { I18nProvider } from '@syntelab/i18n';
import { FirstRunScreen } from './first-run';
import { useShellI18n } from './i18n';
import { preferences } from './preferences';
import { useStore } from './state/create-store';
import { useAppliedTheme } from './theme';
import { ShellWindow } from './window';

/** Root of the interface: applies theme and language, then shows the window. */
export function Shell() {
  const { theme, language, firstRunDone } = useStore(preferences);
  useAppliedTheme(theme);
  const i18n = useShellI18n(language);

  // Nothing with text can be shown before the texts are loaded.
  if (!i18n) return null;

  return <I18nProvider i18n={i18n}>{firstRunDone ? <ShellWindow /> : <FirstRunScreen />}</I18nProvider>;
}
