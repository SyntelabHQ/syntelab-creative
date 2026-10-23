/**
 * The units each tab of the first page lists, in the order of the model's
 * smart tab: the ones most looked for first. A converter that is not named
 * here lists its popular units. Currencies have their own order
 * (`currency-order.ts`).
 */
export const SMART_TAB_UNITS: Readonly<Record<string, readonly string[]>> = {
  length: ['m', 'ft', 'cm', 'in', 'km', 'mm', 'yd', 'mi', 'nmi', 'μm'],
  weight: ['kg', 'lb', 'g', 'oz', 't', 'st', 'mg', 'ton-us', 'ton-uk'],
  temperature: ['C', 'F', 'K', 'R'],
  volume: ['L', 'gal-us', 'mL', 'cup-us', 'm3', 'gal-uk', 'qt-us', 'pt-us', 'fl-oz-us', 'tbsp-us', 'tsp-us'],
  area: ['m2', 'ft2', 'ha', 'in2', 'km2', 'acre', 'yd2', 'mi2'],
  time: ['h', 'min', 'd', 's', 'ms', 'wk', 'mo', 'yr'],
};
