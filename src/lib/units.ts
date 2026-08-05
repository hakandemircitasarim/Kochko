/**
 * Unit Conversion Utilities
 * Spec 2.1: Metrik / Imperial birim desteği
 */

export type UnitSystem = 'metric' | 'imperial';

// Weight
export function kgToLbs(kg: number): number {
  return Math.round(kg * 2.20462 * 10) / 10;
}

export function lbsToKg(lbs: number): number {
  return Math.round(lbs / 2.20462 * 10) / 10;
}

// Height
export function cmToFtIn(cm: number): { feet: number; inches: number } {
  const totalInches = cm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  return { feet, inches };
}

export function ftInToCm(feet: number, inches: number): number {
  return Math.round((feet * 12 + inches) * 2.54);
}

// Volume
export function litersToFlOz(liters: number): number {
  return Math.round(liters * 33.814 * 10) / 10;
}

export function flOzToLiters(flOz: number): number {
  return Math.round(flOz / 33.814 * 100) / 100;
}

// Temperature (for future use)
export function celsiusToFahrenheit(c: number): number {
  return Math.round((c * 9 / 5 + 32) * 10) / 10;
}

/**
 * A number written the way this app writes numbers: Turkish decimal comma.
 *
 * Every display surface in the app renders "85,4 kg" — Turkish decimal comma — but the
 * editors behind them were seeded with `String(85.4)`, so opening the weight sheet or
 * "Profil düzenle" showed "85.4". Same screen, two decimal marks: the weight sheet's own
 * delta line right underneath said "+0,1 kg" while the field said "85.4".
 *
 * Only the WRITING was wrong; every parser already normalises ',' before parseFloat, so a
 * user typing either form has always worked. Use this wherever a stored number reaches the
 * screen — an editable field OR a plain label (settings/goals printed "Mevcut: 85.4 kg"
 * directly above a chart labelled "86,0 kg -> 78,0 kg").
 */
export function formatDecimal(n: number): string {
  return String(n).replace('.', ',');
}

/**
 * Format weight value based on unit preference.
 */
export function formatWeight(kg: number, system: UnitSystem): string {
  if (system === 'imperial') return `${kgToLbs(kg)} lbs`;
  return `${kg} kg`;
}

/**
 * Format height value based on unit preference.
 */
export function formatHeight(cm: number, system: UnitSystem): string {
  if (system === 'imperial') {
    const { feet, inches } = cmToFtIn(cm);
    return `${feet}'${inches}"`;
  }
  return `${cm} cm`;
}

/**
 * Format volume based on unit preference.
 */
export function formatVolume(liters: number, system: UnitSystem): string {
  if (system === 'imperial') return `${litersToFlOz(liters)} fl oz`;
  return `${liters.toFixed(1)} L`;
}

/**
 * Format food weight based on user's portion language preference.
 * Spec 2.1: "gram" vs "household" measures.
 */
export function formatPortion(grams: number, portionLanguage: 'grams' | 'household'): string {
  if (portionLanguage === 'grams') return `${Math.round(grams)}g`;

  // Convert to household measures (approximate)
  if (grams <= 5) return '1 cay kasigi';
  if (grams <= 15) return '1 yemek kasigi';
  if (grams <= 30) return '1 avuc';
  if (grams <= 100) return 'yaklasik 1 kase';
  if (grams <= 200) return '1 porsiyon';
  if (grams <= 300) return 'buyuk 1 porsiyon';
  return `${Math.round(grams)}g`;
}
