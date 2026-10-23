/** The formats a document can be written out as; each name is also the ending of its files. */
export const EXPORT_FORMATS = [
  { format: 'docx', group: 'documents' },
  { format: 'odt', group: 'documents' },
  { format: 'txt', group: 'text' },
  { format: 'html', group: 'text' },
  { format: 'xml', group: 'text' },
  { format: 'png', group: 'pictures' },
  { format: 'jpg', group: 'pictures' },
  { format: 'tiff', group: 'pictures' },
  { format: 'svg', group: 'pictures' },
  { format: 'ps', group: 'print' },
] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number]['format'];
export const EXPORT_GROUPS = ['documents', 'text', 'pictures', 'print'] as const;

/** Dots per inch offered for pictures of pages: screen, a good screen, office print, fine print. */
export const RESOLUTIONS = [72, 96, 150, 300, 600] as const;

/** True for the formats that are pictures made of dots, which have a resolution. */
export function isPictureFormat(format: ExportFormat): boolean {
  return format === 'png' || format === 'jpg' || format === 'tiff';
}

/** What the user chose in the export window. */
export interface ExportChoice {
  readonly format: ExportFormat;
  /** Dots per inch, for pictures. */
  readonly resolution: number;
  /** For JPEG, from 1 to 100. */
  readonly quality: number;
}

/** What the Rust side is asked (`export_document`), besides the pages and where to write. */
export function exportRequest(choice: ExportChoice): { format: ExportFormat; resolution?: number; quality?: number } {
  if (!isPictureFormat(choice.format)) return { format: choice.format };
  return choice.format === 'jpg' ? { format: 'jpg', resolution: choice.resolution, quality: choice.quality } : { format: choice.format, resolution: choice.resolution };
}
