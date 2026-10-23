import type { PrintOptions, PrintPage } from '@syntelab/shell-api';
import './print.css';

const SHEETS_CLASS = 'sc-print-sheets';
const STYLE_ID = 'sc-print-sheet-size';
const ATTEMPTS = 4;
const RETRY_MILLISECONDS = 400;
/** Taken off the height of a sheet given in millimetres, so rounding never spills onto an extra, empty sheet. */
const SPARE_MILLIMETRES = 0.4;

/** Loads one picture, asking again a few times: the Rust side may drop a request while busy. */
async function load(image: HTMLImageElement, url: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    const separator = url.includes('?') ? '&' : '?';
    image.src = attempt === 0 ? url : `${url}${separator}attempt=${attempt}`;
    try {
      await image.decode();
      return;
    } catch (error) {
      if (attempt + 1 >= ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_MILLISECONDS));
    }
  }
}

/** True when the page goes on a sheet turned sideways. */
export function printsSideways(page: PrintPage, orientation: PrintOptions['orientation']): boolean {
  if (orientation === 'portrait') return false;
  if (orientation === 'landscape') return true;
  return page.landscape;
}

/**
 * The rules that give the print window its sheet: with a size, the window
 * starts with that paper and turns it by itself for wide pages; without, the
 * printer's own paper is used (print.css).
 */
export function sheetRules(sheet: PrintOptions['sheet']): string {
  if (!sheet) return '';
  const { width, height } = sheet;
  return `@page { size: ${width}mm ${height}mm; margin: 0; } @page sc-wide { size: ${height}mm ${width}mm; margin: 0; }`;
}

/**
 * Prints pictures, one per sheet. They are put in a part of the page that
 * only exists on paper (print.css hides the program and shows the sheets),
 * and the web view's own print window does the rest.
 */
export async function printImages(pages: readonly PrintPage[], options: PrintOptions = {}): Promise<void> {
  if (pages.length === 0) return;
  document.querySelector(`.${SHEETS_CLASS}`)?.remove();
  document.getElementById(STYLE_ID)?.remove();
  const sheets = document.createElement('div');
  sheets.className = SHEETS_CLASS;
  sheets.setAttribute('aria-hidden', 'true');
  const rules = document.createElement('style');
  rules.id = STYLE_ID;
  rules.textContent = sheetRules(options.sheet);
  document.head.append(rules);
  document.body.append(sheets);

  try {
    // One after another, so the pictures are not competing with each other.
    for (const page of pages) {
      const sideways = printsSideways(page, options.orientation);
      const sheet = document.createElement('div');
      sheet.className = 'sc-print-sheet';
      sheet.dataset.landscape = String(sideways);
      if (options.sheet) {
        const [width, height] = sideways ? [options.sheet.height, options.sheet.width] : [options.sheet.width, options.sheet.height];
        sheet.style.width = `${width}mm`;
        sheet.style.height = `${height - SPARE_MILLIMETRES}mm`;
      }
      const image = new Image();
      // At its real size, where that is known and wanted; else as large as the sheet allows.
      if (options.fit === false && page.width && page.height) {
        image.dataset.actual = 'true';
        image.style.width = `${page.width}mm`;
        image.style.height = `${page.height}mm`;
      }
      sheet.append(image);
      sheets.append(sheet);
      await load(image, page.url);
    }
    await new Promise<void>((resolve) => {
      window.addEventListener('afterprint', () => resolve(), { once: true });
      window.print();
    });
  } finally {
    sheets.remove();
    rules.remove();
  }
}
