// Water quantity semantics: is the stated amount the DAY'S TOTAL or ONE MORE DRINK?
//
// Live 2026-10-04: "bugün 2 litre içtim" was added on top of the glasses logged earlier, so a user
// who reported their day's total ended at 3.5 L. A day-total statement SETS the day's water; a
// single drink ("2 bardak su içtim", "1 litre daha") ADDS. This module is the single owner of that
// decision — the model's water_log carries only the amount.

const L = String.raw`[\p{L}]`;
const word = (body: string) => new RegExp(String.raw`(?<!${L})(?:${body})(?!${L})`, 'u');

/** Explicit totals: the user is stating the day's sum, whatever the unit. */
const STRONG_TOTAL = word(String.raw`toplam(?:da)?|[şs]u\s+ana\s+kadar|[şs]imdiye\s+kadar|g[üu]n\s+boyu(?:nca)?|b[üu]t[üu]n\s+g[üu]n|t[üu]m\s+g[üu]n`);
/** "bugün … litre …" reads as a day total unless something marks it as one more drink. */
const TODAY = word(String.raw`bug[üu]n`);
const LITRE_UNIT = /\d+(?:[.,]\d+)?\s*(?:litre|lt|l)(?![\p{L}])|yar[ıi]m\s*(?:litre|lt|l)(?![\p{L}])/u;
/** One-more-drink markers: these always win over a total reading. */
const INCREMENT = word(String.raw`daha|[şs]imdi|az\s+[öo]nce|biraz\s+[öo]nce|demin|yeni|ekle|ilave`);

export function waterIsDailyTotal(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLocaleLowerCase('tr');
  if (INCREMENT.test(m)) return false;
  if (STRONG_TOTAL.test(m)) return true;
  return TODAY.test(m) && LITRE_UNIT.test(m);
}

/** Next stored value for a day given the current value, the stated amount and its semantics. */
export function nextWaterLiters(current: number, liters: number, isTotal: boolean): number {
  const next = isTotal ? liters : current + liters;
  return Math.round(next * 100) / 100;
}
