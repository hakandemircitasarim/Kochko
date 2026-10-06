/**
 * write-registry/refs.ts — short record handles the model can point at (AI_MIMARI_V2 §4.2/§6).
 *
 * The model never sees or sends a uuid. The turn loader renders the user's own rows with short
 * tokens (`m12 · Per 2 Eki akşam · "6 tavuk nugget" …`) and keeps a server-side refMap
 * token → uuid for THIS turn only. So a ref can name only a row the user was shown — it cannot be
 * guessed into another user's data — and validateDecision rejects any token outside that set.
 *
 * Token grammar: kind prefix + positive integer, e.g. m12, d3, c1, dft1. Kinds are fixed here.
 */

export const REF_KINDS = {
  m: { tr: 'öğün', table: 'meal_logs' },
  d: { tr: 'günlük metrik yazması (su, uyku, ruh hali, adım, tartı)', table: 'daily_metrics' },
  w: { tr: 'antrenman', table: 'workout_logs' },
  s: { tr: 'takviye', table: 'supplement_logs' },
  t: { tr: 'son turların yazması (defter satırı)', table: 'turn_writes' },
  p: { tr: 'onay bekleyen yazma', table: 'pending_writes' },
  c: { tr: 'kısıt (alerji, sakatlık, hastalık, ilaç, diyet)', table: 'user_constraints' },
  k: { tr: 'açık söz/taahhüt', table: 'user_commitments' },
  e: { tr: 'yaklaşan olay', table: 'life_events' },
  l: { tr: 'tahlil değeri', table: 'lab_values' },
  f: { tr: 'yemek tercihi', table: 'food_preferences' },
  dft: { tr: 'plan taslağı', table: 'weekly_plans' },
} as const;

export type RefKind = keyof typeof REF_KINDS;

/**
 * Headings of the per-turn TurnInput blocks the doc and the op texts refer to ("KAYITLAR’daki
 * bir kayıt…"). The input renderer MUST use these exact strings, so the words the model reads in
 * the cached doc point at the blocks it sees in the turn.
 */
export const BLOCK_TITLES = {
  records: 'KAYITLAR',
  constraints: 'KISITLAR',
  pending: 'BEKLEYEN ONAYLAR',
  commitments: 'AÇIK SÖZLER',
  draft: 'PLAN TASLAĞI',
  references: 'REFERANS ADAYLARI',
} as const;

/** Which ref kinds each block renders. */
export const BLOCK_REF_KINDS: Readonly<Record<keyof typeof BLOCK_TITLES, readonly RefKind[]>> = {
  records: ['m', 'd', 'w', 's', 't', 'e', 'l', 'f'],
  constraints: ['c'],
  pending: ['p'],
  commitments: ['k'],
  draft: ['dft'],
  references: [],
};

const REF_RE = /^(dft|[mdwstpckelf])([1-9]\d{0,4})$/;

/** Parse a token ('m12' → {kind:'m', n:12}); null for anything else (including 'M12', 'm0'). */
export function parseRef(token: unknown): { kind: RefKind; n: number } | null {
  if (typeof token !== 'string') return null;
  const m = REF_RE.exec(token);
  return m ? { kind: m[1] as RefKind, n: Number(m[2]) } : null;
}

export function formatRef(kind: RefKind, n: number): string {
  return `${kind}${n}`;
}

/** What a daily-metric / ledger ref points at (needed to match a correction to its record type). */
export type RefTarget =
  | 'meal' | 'water' | 'weight' | 'sleep' | 'mood' | 'steps' | 'workout' | 'supplement'
  | 'constraint' | 'commitment' | 'pending' | 'life_event' | 'lab' | 'food_pref' | 'plan_draft'
  | 'profile' | 'goal' | 'other';

/**
 * One row the loader rendered this turn. The loader builds these from the user's OWN rows only,
 * so "owned" is structural; the flags below are what the validator still has to check.
 */
export interface RenderedRef {
  kind: RefKind;
  target: RefTarget;
  /** Registry op that wrote the row, when known (a correction must patch with the same op). */
  op?: string | null;
  /** The record's local day (YYYY-MM-DD). */
  day?: string | null;
  /** Already undone/soft-deleted/superseded — cannot be undone again. */
  undone?: boolean;
  /** A later write touched the same field (undoing this one would clobber it). */
  later_write_on_same_field?: boolean;
  /** Written in the previous turn ("son tur"). */
  last_turn?: boolean;
  /** One-line Turkish summary the model was shown (receipts quote it back). */
  summary_tr?: string | null;
  /** c#: the spine row's safety facts. */
  constraint?: {
    kind: string;
    subject: string;
    severity: string | null;
    body_parts?: string[];
  } | null;
  /** p#: the hold's facts. `replies_since` = coach replies stored after the hold was written. */
  pending?: {
    op: string;
    expires_at: string;
    replies_since: number;
  } | null;
}

export type RenderedRefs = Readonly<Record<string, RenderedRef>>;

/** Which ref kinds a record_ops delete may target (safety rows and holds have their own ops). */
export const DELETABLE_KINDS: readonly RefKind[] = ['m', 'd', 'w', 's', 't', 'e', 'l', 'f'];

/** A correction (record_ops.update) must use the op that owns the record type. */
export const PATCH_OPS_BY_TARGET: Readonly<Partial<Record<RefTarget, readonly string[]>>> = {
  meal: ['meal_log'],
  water: ['water_log'],
  weight: ['body_weight'],
  sleep: ['sleep_log'],
  mood: ['mood_log'],
  steps: ['step_log'],
  workout: ['workout_log'],
  supplement: ['supplement_log'],
  life_event: ['life_event'],
  lab: ['lab_value'],
  food_pref: ['food_pref'],
};
