import { sheetOf } from './sheets';
import type { SheetName } from './sheets';
/** PDF points in one millimetre (a point is 1/72 inch). */
export const POINTS_PER_MILLIMETRE = 72 / 25.4;

/** How much is cut off each edge of a page as shown, in millimetres. */
export interface Margins {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export const NO_MARGINS: Margins = { left: 0, top: 0, right: 0, bottom: 0 };

/** A new shape for pages, as the Rust side takes it (`reshape_pages`), in points. */
export interface CropRequest {
  readonly crop: Margins;
}

export interface FitRequest {
  readonly fit: {
    readonly width: number;
    readonly height: number;
    readonly matchOrientation: boolean;
    /** The page is not made larger than it is. */
    readonly keepSize?: boolean;
    /** Where the page lies on the sheet: across and down, each 0 (left, top), 0.5 (the middle) or 1 (right, bottom). */
    readonly place?: readonly [number, number];
  };
}

/** Where on a page a label (a page number) is written. */
export const PLACES = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'] as const;
export type Place = (typeof PLACES)[number];

export interface LabelRequest {
  /** One text for each page, in order; `size` and `margin` are in points. */
  readonly label: { readonly texts: readonly string[]; readonly place: Place; readonly size: number; readonly margin: number };
}

/** A rectangle on a page as shown, in points from its top-left corner. */
export interface Area {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PictureRequest {
  /**
   * A PNG or JPEG as base64. With `area` it fills that area; without, it is
   * drawn over the middle of each page, taking `width` (0 to 1) of it.
   */
  readonly picture: { readonly data: string; readonly width?: number; readonly area?: Area };
}

/** Red, green and blue, each from 0 to 1. */
export type Color = readonly [number, number, number];

export interface TextRequest {
  /** Text written from the point (`x`, `y`), the top-left corner of its first line; `size` in points. */
  readonly text: { readonly text: string; readonly x: number; readonly y: number; readonly size: number; readonly color: Color };
}

const SHAPE_KINDS = ['rectangle', 'ellipse', 'line-down', 'line-up', 'check', 'cross', 'dot'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export interface ShapeRequest {
  readonly shape: {
    readonly kind: ShapeKind;
    readonly area: Area;
    readonly color: Color;
    /** In points. */
    readonly lineWidth: number;
    readonly fill?: Color;
  };
}

/** What is in the area is removed from the file for good; a black box is left. */
export interface RedactRequest {
  readonly redact: { readonly area: Area };
}

export type Reshape =
  | CropRequest
  | FitRequest
  | LabelRequest
  | PictureRequest
  | TextRequest
  | ShapeRequest
  | RedactRequest;

export function cropRequest(millimetres: Margins): CropRequest {
  const points = (value: number) => Math.max(0, value || 0) * POINTS_PER_MILLIMETRE;
  return {
    crop: {
      left: points(millimetres.left),
      top: points(millimetres.top),
      right: points(millimetres.right),
      bottom: points(millimetres.bottom),
    },
  };
}

export function fitRequest(sheet: SheetName, matchOrientation: boolean): FitRequest {
  const { width, height } = sheetOf(sheet);
  return { fit: { width: width * POINTS_PER_MILLIMETRE, height: height * POINTS_PER_MILLIMETRE, matchOrientation } };
}

/**
 * True when the margins leave something of a page that measures
 * `width` × `height` points as shown.
 */
export function leavesSomething(millimetres: Margins, width: number, height: number): boolean {
  const { crop } = cropRequest(millimetres);
  return crop.left + crop.right < width - 4 && crop.top + crop.bottom < height - 4;
}
