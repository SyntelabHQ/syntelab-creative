import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@syntelab/ui-kit/styles.css';
import { installTooltips } from '@syntelab/ui-kit';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerBrandFonts } from './brand';
import { preferences } from './preferences';
import { Shell } from './shell';

registerBrandFonts();
// Tooltips are there unless the user turned them off in Settings; the choice counts at once.
/** How long the pointer rests on a control before its tooltip shows, when it is not at once. */
const TOOLTIP_WAIT = 2000;
const tooltipsAs = (mode: ReturnType<typeof preferences.get>['tooltips']) => (mode === 'off' ? null : installTooltips(mode === 'instant' ? 0 : TOOLTIP_WAIT));
let tooltipMode = preferences.get().tooltips;
let removeTooltips = tooltipsAs(tooltipMode);
preferences.subscribe(() => {
  const wanted = preferences.get().tooltips;
  if (wanted === tooltipMode) return;
  tooltipMode = wanted;
  removeTooltips?.();
  removeTooltips = tooltipsAs(wanted);
});

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

createRoot(root).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
