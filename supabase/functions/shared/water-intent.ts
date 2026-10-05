// Water quantity semantics: is the stated amount the DAY'S TOTAL or ONE MORE DRINK?
//
// Live 2026-10-04: "bugün 2 litre içtim" was added on top of the glasses logged earlier, so a user
// who reported their day's total ended at 3.5 L. A day-total statement SETS the day's water; a
// single drink ("2 bardak su içtim", "1 litre daha") ADDS.
//
// Faz 0 #2 (docs/AI_MIMARI_V2.md §4.4): the MODEL now owns that decision (water_log.mode) and states
// the amount as quantity + unit; this module does the unit math and the hard bounds. The
// whole-message regex below is only a FALLBACK for a legacy action that carries no mode — it read
// "bir bardak su içtim, toplam kaç oldu?" as a SET that wiped the day (diff#1) and
// "bugün toplam 2 litre su içtim, ekle" as an ADD (diff#2).

const L = String.raw`[\p{L}]`;
const word = (body: string) => new RegExp(String.raw`(?<!${L})(?:${body})(?!${L})`, 'u');

/** Explicit totals: the user is stating the day's sum, whatever the unit. */
const STRONG_TOTAL = word(String.raw`toplam(?:da)?|[şs]u\s+ana\s+kadar|[şs]imdiye\s+kadar|g[üu]n\s+boyu(?:nca)?|b[üu]t[üu]n\s+g[üu]n|t[üu]m\s+g[üu]n`);
/** "bugün … litre …" reads as a day total unless something marks it as one more drink. */
const TODAY = word(String.raw`bug[üu]n`);
const LITRE_UNIT = /\d+(?:[.,]\d+)?\s*(?:litre|lt|l)(?![\p{L}])|yar[ıi]m\s*(?:litre|lt|l)(?![\p{L}])/u;
/** One-more-drink markers: these always win over a total reading. */
const INCREMENT = word(String.raw`daha|[şs]imdi|az\s+[öo]nce|biraz\s+[öo]nce|demin|yeni|ekle|ilave`);

/** Legacy fallback only (an action without `mode`) — see the module note. */
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

// ─── water_log write contract (AI_MIMARI_V2 §4.4) ───────────────────────────────────────────────
// {as_stated, quantity, unit, other_ml_each?, mode}. "1 bardak su" used to arrive as {liters: 1}: the
// model wrote the GLASS COUNT into the litre field (final2#3). Now it says how many of which
// container; code converts. as_stated is the user's own phrase, kept for the log and never parsed.

/** ml per ONE unit. `other` is not here: the model gives its own ml estimate in other_ml_each. */
export const WATER_UNIT_ML = {
  ml: 1, litre: 1000,
  bardak: 200, su_bardagi: 200, cay_bardagi: 100, kupa: 250,
  sise_330: 330, sise_500: 500, sise_1500: 1500,
} as const;
export type WaterUnit = keyof typeof WATER_UNIT_ML | 'other';
export type WaterMode = 'add' | 'set_day_total';

/** Hard bound per write (litres): outside it nothing is written — the value is never clamped. */
export const WATER_MAX_LITERS_PER_WRITE = 8;
/** A single ADD above this is stored but FLAGGED in the receipt (§5.1 makullük), not rewritten. */
export const WATER_FLAG_SINGLE_ADD_LITERS = 1.5;

/** The model's mode, or null when it gave none (→ legacy regex fallback in ai-chat). */
export function waterModeOf(action: Record<string, unknown>): WaterMode | null {
  const m = typeof action.mode === 'string' ? action.mode.trim().toLowerCase() : '';
  return m === 'add' || m === 'set_day_total' ? m : null;
}

// Tolerates spelling of the MODEL's enum value ("su bardağı", "L", "Litre") — this is the model's
// field, not user text.
const UNIT_ALIASES: Record<string, WaterUnit> = { l: 'litre', lt: 'litre', liter: 'litre', mililitre: 'ml' };
function unitOf(raw: unknown): WaterUnit | null {
  if (typeof raw !== 'string') return null;
  const k = raw.toLocaleLowerCase('tr').trim()
    .replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/[\s-]+/g, '_');
  if (k === 'other' || k in WATER_UNIT_ML) return k as WaterUnit;
  return UNIT_ALIASES[k] ?? null;
}

function numOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export type WaterDerivation =
  | { ok: true; liters: number; mode: WaterMode | null; source: 'unit' | 'legacy_liters' }
  | { ok: false; reason: 'no_amount' | 'bad_unit' | 'other_without_ml' | 'bad_quantity' | 'out_of_range' };

/**
 * water_log action → litres for this write. quantity+unit is authoritative when present (an
 * incomplete new-shape action is REJECTED, not patched from another field); a legacy {liters}
 * action is accepted as the fallback. Bounds: quantity [0, 50] (ml: up to the litre cap),
 * other_ml_each [1, 3000], litres [0, WATER_MAX_LITERS_PER_WRITE].
 */
export function deriveWaterLiters(action: Record<string, unknown>): WaterDerivation {
  const mode = waterModeOf(action);
  const hasNewShape = action.quantity != null || action.unit != null;
  let liters: number;
  let source: 'unit' | 'legacy_liters';
  if (hasNewShape) {
    const unit = unitOf(action.unit);
    if (!unit) return { ok: false, reason: 'bad_unit' };
    // §4.4's quantity bound [0, 50] is a CONTAINER count; "500 ml" is quantity 500, so ml is bounded
    // by the litre cap below instead.
    const quantity = numOf(action.quantity);
    const maxQuantity = unit === 'ml' ? WATER_MAX_LITERS_PER_WRITE * 1000 : 50;
    if (quantity == null || quantity < 0 || quantity > maxQuantity) return { ok: false, reason: 'bad_quantity' };
    let mlEach: number;
    if (unit === 'other') {
      const o = numOf(action.other_ml_each);
      if (o == null || o < 1 || o > 3000) return { ok: false, reason: 'other_without_ml' };
      mlEach = o;
    } else {
      mlEach = WATER_UNIT_ML[unit];
    }
    liters = round2((quantity * mlEach) / 1000);
    source = 'unit';
  } else {
    const l = numOf(action.liters);
    if (l == null) return { ok: false, reason: 'no_amount' };
    liters = round2(l);
    source = 'legacy_liters';
  }
  if (liters < 0 || liters > WATER_MAX_LITERS_PER_WRITE) return { ok: false, reason: 'out_of_range' };
  return { ok: true, liters, mode, source };
}
