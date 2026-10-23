import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { I18n } from '../i18n';
import type { Translate } from '../translator';

const I18nContext = createContext<I18n | null>(null);

export interface I18nProviderProps {
  readonly i18n: I18n;
  readonly children: ReactNode;
}

export function I18nProvider({ i18n, children }: I18nProviderProps) {
  return <I18nContext.Provider value={i18n}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const i18n = useContext(I18nContext);
  if (!i18n) throw new Error('useI18n must be used inside an I18nProvider');
  return i18n;
}

export function useTranslation(): Translate {
  return useI18n().t;
}
