import type { AppHost, PrintOptions, PrintPage } from '@syntelab/shell-api';
import type { OrganizerSettings } from '../settings/organizer-settings';
import { PRINTER_SHEET } from '../settings/organizer-settings';
import { POINTS_PER_MILLIMETRE } from './page-shape';
import { sheetOf } from './sheets';
import type { PlanPage } from './page-plan';

/** Pictures at 3 × 72 = 216 dots per inch read well on paper… */
const SHARP_SCALE = 3;
/** …and a long document is drawn at 144, to keep the memory it takes in check. */
const LONG_DOCUMENT_SCALE = 2;
const LONG_DOCUMENT_PAGES = 40;

/** The pictures to print for a page plan: each page as it is arranged now, with its turn. */
export function printPages(host: Pick<AppHost, 'resourceUrl'>, plan: readonly PlanPage[]): PrintPage[] {
  const scale = plan.length > LONG_DOCUMENT_PAGES ? LONG_DOCUMENT_SCALE : SHARP_SCALE;
  return plan.map((page) => {
    const sideways = page.rotation % 180 !== 0;
    const width = sideways ? page.height : page.width;
    const height = sideways ? page.width : page.height;
    return {
      url: host.resourceUrl(`page/${page.documentId}/${page.page}`, { scale, rotate: page.rotation }),
      landscape: width > height,
      width: width / POINTS_PER_MILLIMETRE,
      height: height / POINTS_PER_MILLIMETRE,
    };
  });
}

/** How pages are put on paper, as the app's settings say. */
export function printOptions(settings: Pick<OrganizerSettings, 'printSheet' | 'printOrientation' | 'printScaling'>): PrintOptions {
  return {
    sheet: settings.printSheet === PRINTER_SHEET ? undefined : { width: sheetOf(settings.printSheet).width, height: sheetOf(settings.printSheet).height },
    orientation: settings.printOrientation,
    fit: settings.printScaling === 'fit',
  };
}
