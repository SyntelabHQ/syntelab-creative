import type { AppHost } from '@syntelab/shell-api';

/** A picture ready to be shown and put on a page. */
export interface LoadedPicture {
  /** A data address the interface can show: a PNG or a JPEG. */
  readonly address: string;
  /** In pixels. */
  readonly width: number;
  readonly height: number;
}

/** The longest side a picture decoded here keeps, in pixels; a drawing without a size of its own gets this. */
const LARGEST_SIDE = 4000;

/** Draws whatever the web view can show onto a canvas and returns it as a PNG. */
async function decodeHere(address: string): Promise<LoadedPicture> {
  const image = new Image();
  image.src = address;
  await image.decode();
  // A drawing (SVG) may say nothing about its size.
  const naturalWidth = image.naturalWidth || 1000;
  const naturalHeight = image.naturalHeight || 1000;
  const shrink = Math.min(1, LARGEST_SIDE / Math.max(naturalWidth, naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(naturalWidth * shrink));
  canvas.height = Math.max(1, Math.round(naturalHeight * shrink));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no canvas to decode the picture on');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { address: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}

/**
 * Reads a picture file of any format the program knows. The Rust side reads
 * most (and hands over what the web view can show); the web view decodes the
 * ones it alone knows (WebP, SVG…). Rejects when the file is not a picture.
 */
export async function loadPicture(host: Pick<AppHost, 'invoke'>, path: string): Promise<LoadedPicture> {
  const read = await host.invoke<{ data: string; type: string; width: number; height: number }>('read_picture', { path });
  const address = `data:${read.type};base64,${read.data}`;
  return read.width > 0 ? { address, width: read.width, height: read.height } : decodeHere(address);
}
