/**
 * The order the smart converter lists currencies in, as the model's smart tab
 * has them: the most traded first, then by code. Currencies that are not
 * named here (the converter has more than the model's smart tab) come after,
 * as the converter lists them.
 */
const FIAT = 'usd eur gbp jpy cny cad aud chf inr krw sgd hkd aed amd ars azn bam bdt bgn bhd bob brl byn clp cop crc czk dkk egp gel ghs gtq hrk huf idr ils jod kes kwd kzt lkr mdl mkd mxn myr ngn nok nzd omr pab pen php pkr pln qar ron rsd rub sar sek thb try twd uah uyu uzs vnd zar all';
const CRYPTO = 'btc eth usdt usdc bnb xrp sol ada doge ltc avax dot link near pol shib ton';

const PLACE = new Map([...FIAT.split(' '), ...CRYPTO.split(' ')].map((id, at) => [id, at]));

/** Currencies in the order of the model's smart tab; the others after, as they were. */
export function inSmartTabOrder<T extends { readonly id: string }>(units: readonly T[]): T[] {
  const place = (unit: T, at: number) => PLACE.get(unit.id) ?? PLACE.size + at;
  return units.map((unit, at) => ({ unit, at: place(unit, at) })).sort((one, other) => one.at - other.at).map((entry) => entry.unit);
}
