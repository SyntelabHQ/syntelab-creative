// Sansation is the brand font. Its files are added by hand to
// assets/brand/fonts/sansation/ (see the README there). Until then nothing is
// found here and `--sc-font-brand` falls back to the interface font.
const sansationFiles = import.meta.glob<string>('../../../assets/brand/fonts/sansation/*.{woff2,woff,ttf,otf}', {
  query: '?url',
  import: 'default',
  eager: true,
});

/** Reads weight and style from names like `Sansation_Bold_Italic.ttf`. */
function describe(path: string): FontFaceDescriptors {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  return {
    weight: name.includes('bold') ? '700' : name.includes('light') ? '300' : '400',
    style: name.includes('italic') ? 'italic' : 'normal',
  };
}

/** Registers every Sansation file found; each is fetched only when first used. */
export function registerBrandFonts(): void {
  for (const [path, url] of Object.entries(sansationFiles)) {
    document.fonts.add(new FontFace('Sansation', `url("${url}")`, describe(path)));
  }
}
