import type { LoadedPicture } from '../document/load-picture';

/**
 * Turns the pixels of a photographed or scanned signature into ink on
 * nothing: the paper becomes see-through, the pen strokes stay. Works on the
 * pixels in place (red, green, blue, alpha for each).
 *
 * The paper is taken to be the brightness most of the picture has; a pixel
 * is ink by how much darker than the paper it is.
 */
export function keepInk(pixels: Uint8ClampedArray): void {
  // How bright each pixel is, and how often each brightness occurs.
  const counts = new Uint32Array(256);
  const brightness = new Uint8Array(pixels.length / 4);
  for (let index = 0; index < brightness.length; index++) {
    const at = index * 4;
    const value = Math.round(0.299 * (pixels[at] ?? 0) + 0.587 * (pixels[at + 1] ?? 0) + 0.114 * (pixels[at + 2] ?? 0));
    brightness[index] = value;
    counts[value] = (counts[value] ?? 0) + 1;
  }
  // The paper: the brightness that three quarters of the pixels do not exceed.
  let paper = 255;
  for (let value = 0, seen = 0; value < 256; value++) {
    seen += counts[value] ?? 0;
    if (seen >= brightness.length * 0.75) {
      paper = value;
      break;
    }
  }
  // Anything nearly as bright as the paper is paper; ink is solid from well below it.
  const clear = paper * 0.86;
  const solid = paper * 0.5;
  for (let index = 0; index < brightness.length; index++) {
    const value = brightness[index] ?? 255;
    const ink = value >= clear ? 0 : value <= solid ? 1 : (clear - value) / (clear - solid);
    const at = index * 4;
    pixels[at + 3] = Math.round((pixels[at + 3] ?? 255) * ink);
  }
}

/** The part of a canvas that is not see-through, with a small margin; null when nothing is. */
function inkBounds(data: Uint8ClampedArray, width: number, height: number): [number, number, number, number] | null {
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) < 24) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left) return null;
  const margin = Math.round(Math.max(width, height) * 0.01);
  return [Math.max(0, left - margin), Math.max(0, top - margin), Math.min(width - 1, right + margin), Math.min(height - 1, bottom + margin)];
}

/** The longest side a signature keeps, in pixels: plenty for paper, small to store. */
const LARGEST_SIDE = 1600;

/**
 * A picture of a signature with the paper behind it removed and cut down to
 * the signature itself. Returns the picture as it was when nothing is left
 * (a blank page, a picture that is all "paper").
 */
export async function withoutPaper(picture: LoadedPicture): Promise<LoadedPicture> {
  const image = new Image();
  image.src = picture.address;
  await image.decode();
  const shrink = Math.min(1, LARGEST_SIDE / Math.max(picture.width, picture.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(picture.width * shrink));
  canvas.height = Math.max(1, Math.round(picture.height * shrink));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return picture;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  keepInk(pixels.data);
  const bounds = inkBounds(pixels.data, canvas.width, canvas.height);
  if (!bounds) return picture;
  context.putImageData(pixels, 0, 0);

  const [left, top, right, bottom] = bounds;
  const cut = document.createElement('canvas');
  cut.width = right - left + 1;
  cut.height = bottom - top + 1;
  cut.getContext('2d')?.drawImage(canvas, left, top, cut.width, cut.height, 0, 0, cut.width, cut.height);
  return { address: cut.toDataURL('image/png'), width: cut.width, height: cut.height };
}
