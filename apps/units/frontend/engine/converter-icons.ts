/**
 * The icons of the converters. A converter names its icon as the model's
 * menu does (a Font Awesome icon); its file is in `assets/icons/`. An icon
 * whose file is not there yet is drawn with one that is: add a line here
 * until its file is added.
 */
const STAND_INS: Readonly<Record<string, string>> = {};

/** The icon a converter is drawn with: its own, or what stands in for it. */
export const converterIcon = (icon: string): string => STAND_INS[icon] ?? icon;
