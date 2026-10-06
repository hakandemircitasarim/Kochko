/**
 * write-registry/units.ts — THE unit table (AI_MIMARI_V2 §4.1).
 *
 * Until now three copies disagreed: the water net said "bardak = 250 ml", food-reference's
 * parsePortionToGrams said "su bardağı 200", water-intent had its own list. One table, read by the
 * schema enum, the Turkish doc and derive() — so what the model is told is exactly what code
 * multiplies by.
 *
 * Code does ARITHMETIC with these numbers only after the MODEL picked the unit. It never maps a
 * user's phrase to a unit itself ("koca bir bardak" is the model's call: bardak, or other + ml).
 */

/** Liquid units → millilitres per one unit. */
export const UNIT_ML = {
  ml: 1,
  litre: 1000,
  bardak: 200,
  su_bardagi: 200,
  cay_bardagi: 100,
  kupa: 250,
  fincan: 70,
  sise_330: 330,
  sise_500: 500,
  sise_1500: 1500,
  yemek_kasigi: 15,
  tatli_kasigi: 8,
  cay_kasigi: 5,
} as const;

export type LiquidUnit = keyof typeof UNIT_ML;

/** Turkish meaning of each liquid unit, as the model reads it (schema enum labels + doc). */
export const LIQUID_UNIT_TR: Readonly<Record<LiquidUnit | 'other', string>> = {
  ml: 'mililitre',
  litre: 'litre',
  bardak: 'bardak ≈200 ml',
  su_bardagi: 'su bardağı ≈200 ml',
  cay_bardagi: 'çay bardağı ≈100 ml',
  kupa: 'kupa ≈250 ml',
  fincan: 'fincan ≈70 ml',
  sise_330: 'küçük şişe 330 ml',
  sise_500: 'yarım litrelik şişe',
  sise_1500: 'büyük şişe 1,5 L',
  yemek_kasigi: 'yemek kaşığı ≈15 ml',
  tatli_kasigi: 'tatlı kaşığı ≈8 ml',
  cay_kasigi: 'çay kaşığı ≈5 ml',
  other: 'listede yok → other_ml_each alanına bir biriminin ml tahminini yaz',
};

/**
 * Small solid household measures — HINTS only (doc + reference candidates). A meal item's grams
 * are the MODEL's estimate; code never converts "2 çimdik" itself (§4.3, owner requirement 1).
 */
export const SOLID_HINT_G = {
  cimdik: 0.5,
  cay_kasigi_tuz: 5,
  yemek_kasigi_yag: 13,
} as const;

/** Length units → centimetres (height, waist, hip…). */
export const LENGTH_CM = { cm: 1, m: 100, in: 2.54 } as const;
export type LengthUnit = keyof typeof LENGTH_CM;

/** Millilitres in one `unit` (other → the model's own ml estimate). null = cannot compute. */
export function mlPerUnit(unit: string, otherMlEach: number | null | undefined): number | null {
  if (unit === 'other') return typeof otherMlEach === 'number' && otherMlEach > 0 ? otherMlEach : null;
  return Object.prototype.hasOwnProperty.call(UNIT_ML, unit) ? UNIT_ML[unit as LiquidUnit] : null;
}
