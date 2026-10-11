/**
 * ai-chat/v2/facts.ts — the Stage B fact blocks (AI_MIMARI_V2 §3.2 T6, §5.1.10, §8.2 item 5).
 *
 * Stage B speaks AFTER the writes, so everything it may claim arrives here as a FACT, rendered by
 * code from structured data: the user's state (profile, today's numbers, constraints, plan, holds)
 * and "BU TURDA OLANLAR" — what was really stored, held (with the ONE question), rejected (with the
 * reason) or flagged this turn, plus the tripwire resolution. The coach constitution says this block
 * is the truth; nothing here is an order pile ("ASLA…"), only facts and, where a fact has a
 * consequence the coach must know (a hold to ask, an exposure to acknowledge), that consequence in
 * one plain clause.
 *
 * Numbers come from code (§8.2 "Sayılar"): today's intake is the stored day total PLUS this turn's
 * committed meals/water, computed from the decision and the commit outcome. When code cannot total
 * this turn exactly (a held meal next to a stored one, a corrected meal of today), the line says the
 * number is pre-turn and gives no "kalan" — the coach then speaks without a number instead of
 * inventing one.
 *
 * The missed-write line (§5.1.10) appears ONLY when Stage A's self_check reported new facts,
 * nothing was written or clarified, and no CLOSED reason (NOT_WRITTEN_REASONS) was given; a declared
 * reason is rendered as the reason itself, so an emergency or illness turn never ends with a
 * data-entry question.
 *
 * 2026-10-11 (first live trial): a missed write used to end in "güncelleyeyim mi?" / "kaydedeyim
 * mi?" — a yes/no offer with NO pending hold behind it, so the user's "evet" resolved nothing. A
 * missed write now says plainly that nothing was saved and asks an OPEN question
 * (unanchoredQuestionForbidden); the turn-level commit flags (op 'turn') are rendered as what they
 * are instead of "KAYDEDİLDİ AMA BELİRSİZ (turn)"; a hold shows the numbers code knows (old → new);
 * a confirmed hold's ask reason is no longer passed on as a doubt; the budget line speaks without
 * pipeline words the coach used to echo ("bu turdaki kayıtlar", "koda göre").
 *
 * Pure: no I/O, no clock, no reading of the user's words (the message is only placed by coach.ts).
 */
import type { CoachInput, CommitResult, TripwireResolution, UnderstandDecision, V2Hold, V2Receipt } from './contracts.ts';
import { constraintLine, edTierOf, planTypeTr, profilePhrases, turnRefs, type TurnInput } from './input.ts';
import { dayLabelTr, fmtTr, quoteLine } from './stage-a-request.ts';
import {
  ED_CATEGORIES, findWireOp, getOp, mlPerUnit, NOT_WRITTEN_REASONS, PLAN_OPS, type RenderedRefs, vocab,
} from '../../shared/write-registry/mod.ts';
import { resolveDay } from '../../shared/write-registry/util.ts';
import { allergenSpine } from '../../shared/safety-invariants.ts';

/** Block headings Stage B reads (the constitution names BU TURDA OLANLAR). */
export const FACT_BLOCK_TITLES = {
  state: 'KULLANICI DURUMU',
  extra: 'EK OLGULAR',
  turn: 'BU TURDA OLANLAR',
  safety: 'GÜVENLİK DURUMU',
} as const;

// ─── small helpers ─────────────────────────────────────────────────────────────────────────────────

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Registry title of an op ('meal_log' → 'Öğün'); the raw id only when the registry does not know it. */
export function opTitle(op: string): string {
  return getOp(op)?.title_tr ?? op;
}

/** A receipt belongs to an op when either its v2 type or its legacy client type names it. */
function receiptIs(r: V2Receipt, op: string, legacy: string): boolean {
  return r.action_type === op || r.legacy_type === legacy;
}

// ─── today's numbers (code, not the model) ─────────────────────────────────────────────────────────

/** This turn's committed change to TODAY's intake, as far as code can total it exactly. */
export interface TurnIntakeDelta {
  kcal: number;
  proteinG: number;
  /** New water total for today (null = unchanged or not computable). */
  waterLiters: number | null;
  /** This turn changed today's intake. */
  changed: boolean;
  /** false = it changed in a way code could not total exactly (the numbers are then pre-turn). */
  certain: boolean;
}

function mealTotals(w: Record<string, unknown>): { kcal: number; protein: number } {
  let kcal = 0;
  let protein = 0;
  for (const it of arr(w.items)) {
    if (!isRec(it)) continue;
    kcal += num(it.kcal) ?? 0;
    protein += num(it.protein_g) ?? 0;
  }
  return { kcal, protein };
}

/** How many writes of `op` the commit stored, and whether every one of them is accounted for. */
function outcomeOf(commit: CommitResult, op: string, legacy: string, proposed: number): 'all' | 'none' | 'mixed' {
  const ok = commit.receipts.filter((r) => r.ok && receiptIs(r, op, legacy)).length;
  if (ok === 0) return 'none';
  return ok === proposed ? 'all' : 'mixed';
}

/**
 * Today's intake change from THIS turn: meal_log and water_log writes for today whose outcome is
 * unambiguous (all of that op stored, or none). A correction/delete touching one of today's meals,
 * a `replaces` link, or a partial outcome makes the total uncertain — never guessed.
 */
export function turnIntakeDelta(ti: TurnInput, decision: UnderstandDecision, commit: CommitResult): TurnIntakeDelta {
  const today = ti.day;
  const writes = arr(decision.writes).filter(isRec);
  const meals = writes.filter((w) => w.op === 'meal_log' && w.status !== 'restatement');
  const waters = writes.filter((w) => w.op === 'water_log');
  const todayMeals = meals.filter((w) => resolveDay(w.day, today) === today);
  const todayWaters = waters.filter((w) => resolveDay(w.day, today) === today);

  const mealDayOf = new Map(ti.meals.map((m) => [m.ref, m.day]));
  const touchesTodayMeal = (ref: unknown) => typeof ref === 'string' && mealDayOf.get(ref) === today;
  const recordOps = arr(decision.record_ops).filter(isRec);
  const correctsToday = recordOps.some((o) => touchesTodayMeal(o.ref)) || meals.some((w) => touchesTodayMeal(w.replaces));
  const waterRefs = new Set(ti.metric_days.filter((d) => d.target === 'water' && d.day === today).map((d) => d.ref));
  const correctsWater = recordOps.some((o) => typeof o.ref === 'string' && waterRefs.has(o.ref))
    || waters.some((w) => typeof w.replaces === 'string' && waterRefs.has(w.replaces));

  const delta: TurnIntakeDelta = { kcal: 0, proteinG: 0, waterLiters: null, changed: false, certain: true };
  if (correctsToday || correctsWater) return { ...delta, changed: true, certain: false };

  if (todayMeals.length > 0) {
    const outcome = outcomeOf(commit, 'meal_log', 'meal_log', meals.length);
    if (outcome === 'mixed') return { ...delta, changed: true, certain: false };
    if (outcome === 'all') {
      for (const w of todayMeals) {
        const t = mealTotals(w);
        delta.kcal += t.kcal;
        delta.proteinG += t.protein;
      }
      delta.changed = true;
    }
  }

  if (todayWaters.length > 0) {
    const outcome = outcomeOf(commit, 'water_log', 'water_log', waters.length);
    if (outcome === 'mixed') return { ...delta, changed: true, certain: false };
    if (outcome === 'all') {
      let total = ti.days.find((d) => d.day === today)?.water_liters ?? 0;
      for (const w of todayWaters) {
        const ml = mlPerUnit(String(w.unit ?? ''), num(w.other_ml_each));
        const qty = num(w.quantity);
        if (ml === null || qty === null) return { ...delta, changed: true, certain: false };
        const liters = Math.round((qty * ml) / 10) / 100;
        total = w.mode === 'set_day_total' ? liters : total + liters;
      }
      delta.waterLiters = Math.round(total * 100) / 100;
      delta.changed = true;
    }
  }
  return delta;
}

/** The ONE target (§8.2: plan band, else profile band) and today's position against it. */
export interface BudgetFacts {
  day: string;
  consumedKcal: number;
  proteinG: number;
  band: { min: number; max: number } | null;
  bandSource: 'plan' | 'profile' | null;
  proteinTargetG: number | null;
  waterLiters: number | null;
  waterTargetLiters: number | null;
  /** The numbers include this turn's writes. */
  includesThisTurn: boolean;
  /** false = this turn changed today's intake in a way code could not total (numbers are pre-turn). */
  certain: boolean;
}

function bandOf(min: unknown, max: unknown): { min: number; max: number } | null {
  const lo = num(min);
  const hi = num(max);
  return lo !== null && hi !== null && lo > 0 && hi >= lo ? { min: Math.round(lo), max: Math.round(hi) } : null;
}

export function budgetFacts(ti: TurnInput, delta: TurnIntakeDelta | null = null): BudgetFacts {
  const row = ti.days.find((d) => d.day === ti.day);
  const plan = ti.targets_today;
  const planBand = plan ? bandOf(plan.calorie_target_min, plan.calorie_target_max) : null;
  const profileBand = bandOf(ti.profile.calorie_range_rest_min, ti.profile.calorie_range_rest_max);
  const usable = delta !== null && delta.certain;
  const consumed = (row?.kcal ?? 0) + (usable ? delta.kcal : 0);
  const protein = (row?.protein_g ?? 0) + (usable ? delta.proteinG : 0);
  const water = usable && delta.waterLiters !== null ? delta.waterLiters : (row?.water_liters ?? null);
  const proteinTarget = num(plan?.protein_target_g);
  return {
    day: ti.day,
    consumedKcal: Math.round(consumed),
    proteinG: Math.round(protein),
    band: planBand ?? profileBand,
    bandSource: planBand ? 'plan' : profileBand ? 'profile' : null,
    proteinTargetG: proteinTarget !== null ? Math.round(proteinTarget) : null,
    waterLiters: water,
    waterTargetLiters: num(plan?.water_target_liters) ?? num(ti.profile.water_target_liters),
    includesThisTurn: usable && delta.changed,
    certain: delta === null || delta.certain,
  };
}

/** "Bugün (sunucu): 1.240 kcal · hedef aralığı 1.800–2.000 kcal (plan), alt sınıra 560 kcal var · protein 58 / 120 g · su 1,80 / 2,5 L". */
export function renderBudgetLine(b: BudgetFacts): string {
  const parts: string[] = [];
  if (!b.certain) {
    parts.push(`${fmtTr(b.consumedKcal)} kcal (az önceki değişiklikten önceki toplam; yeni toplam hesaplanamadı, toplam ya da kalan sayısı verme)`);
  } else {
    parts.push(`${fmtTr(b.consumedKcal)} kcal${b.includesThisTurn ? ' (az önce yazılanlar dahil)' : ''}`);
    if (b.band) {
      const pos = b.consumedKcal < b.band.min ? `alt sınıra ${fmtTr(b.band.min - b.consumedKcal)} kcal var`
        : b.consumedKcal > b.band.max ? `üst sınırı ${fmtTr(b.consumedKcal - b.band.max)} kcal aştı`
        : 'aralığın içinde';
      parts.push(`hedef aralığı ${fmtTr(b.band.min)}–${fmtTr(b.band.max)} kcal (${b.bandSource === 'plan' ? 'günlük plan' : 'profil'}), ${pos}`);
    } else {
      parts.push('kalori hedefi tanımlı değil');
    }
  }
  parts.push(b.proteinTargetG !== null ? `protein ${fmtTr(b.proteinG)} / ${fmtTr(b.proteinTargetG)} g` : `protein ${fmtTr(b.proteinG)} g`);
  if (b.waterLiters !== null || b.waterTargetLiters !== null) {
    const now = b.waterLiters !== null ? fmtTr(b.waterLiters, 2) : 'kayıt yok';
    parts.push(b.waterTargetLiters !== null ? `su ${now} / ${fmtTr(b.waterTargetLiters, 1)} L` : `su ${now} L`);
  }
  return `Bugün (sunucu): ${parts.join(' · ')}`;
}

// ─── user state ────────────────────────────────────────────────────────────────────────────────────

const HOLD_OP_TR: Record<string, string> = {
  account_erase_request: 'veri silme talebi',
};

/**
 * KULLANICI DURUMU lines from the TurnInput (+ this turn's budget). Facts only; an empty section is
 * left out instead of printed as "yok", except constraints, whose absence is itself a safety fact.
 */
export function renderUserState(ti: TurnInput, budget: BudgetFacts | null = null): string[] {
  const lines: string[] = [];
  const local = ti.local;
  lines.push(`Şimdi: ${local.weekday_tr} ${local.date} ${local.time}${ti.day !== local.date ? ` (günlük kayıt günü ${ti.day})` : ''}`);

  const prof = profilePhrases(ti.profile, ti.goal);
  if (prof.length > 0) lines.push(`Profil: ${prof.join(' · ')}`);
  if (ti.profile.onboarding_completed === false) {
    const missing = (['gender', 'birth_year', 'height_cm', 'weight_kg'] as const)
      .filter((k) => ti.profile[k] === null || ti.profile[k] === undefined)
      .map((k) => ({ gender: 'cinsiyet', birth_year: 'doğum yılı', height_cm: 'boy', weight_kg: 'kilo' })[k]);
    lines.push(`Tanışma: tamamlanmadı${missing.length ? ` (eksik: ${missing.join(', ')})` : ''}`);
  }

  lines.push(renderBudgetLine(budget ?? budgetFacts(ti)));

  const tier = edTierOf(ti);
  if (tier !== 'none') {
    const TIER_TR: Record<string, string> = {
      watch: 'izleniyor', amber: 'yükselmiş (amber)', red: 'yüksek (kırmızı)', unknown: 'okunamadı',
    };
    const gated = tier === 'amber' || tier === 'red' || tier === 'unknown';
    lines.push(`Yeme bozukluğu risk düzeyi: ${TIER_TR[tier] ?? tier}${gated ? ' (kodda hedef düşürme ve kalori açığı kapalı)' : ''}`);
  }

  if (ti.constraints.length > 0) {
    lines.push('Kısıtlar:');
    for (const c of ti.constraints) {
      const unknownSev = (c.kind === 'allergen' || c.kind === 'intolerance') && (c.severity === null || c.severity === 'moderate');
      // Stage B speaks to the user: body-part ids in Turkish ("knee" → "diz"), never an English enum.
      const body_parts = c.body_parts.map((p) => (vocab.BODY_PARTS as Record<string, string>)[p] ?? p);
      lines.push(`- ${c.ref} ${constraintLine({ kind: c.kind, subject: c.subject, severity: c.severity, body_parts, note: c.note })}${unknownSev ? ' (netleşene kadar ciddi sayılır)' : ''}`);
    }
  } else {
    lines.push('Kısıtlar: kayıtlı alerji, sakatlık ya da hastalık yok');
  }

  if (ti.pending.length > 0) {
    lines.push(`Bekleyen onaylar: ${ti.pending.map((p) => `${p.ref} ${HOLD_OP_TR[p.op] ?? opTitle(p.op)}`).join(' · ')}`);
  }
  if (ti.commitments.length > 0) {
    lines.push(`Açık sözler: ${ti.commitments.map((k) => `${k.ref} "${quoteLine(k.commitment, 80)}"${k.follow_up_at ? ` (takip ${dayLabelTr(k.follow_up_at.slice(0, 10), ti.day)})` : ''}`).join(' · ')}`);
  }
  const plans = [
    ...ti.plans.active.map((a) => `aktif ${planTypeTr(a.plan_type)} planı (hafta ${a.week_start})`),
    ...ti.plans.drafts.map((d) => `${d.ref} ${planTypeTr(d.plan_type)} taslağı (hafta ${d.week_start}, onay bekliyor)`),
  ];
  if (plans.length > 0) lines.push(`Plan: ${plans.join(' · ')}`);
  if (ti.load_errors.length > 0) lines.push(`Okunamayan bölümler: ${ti.load_errors.map((e) => e.section).join(', ')} (bu konularda bilgi eksik)`);
  return lines;
}

// ─── BU TURDA OLANLAR ──────────────────────────────────────────────────────────────────────────────

/** §5.1.10, mirrored from validateDecision (same rule, read straight off the decision). */
export function missedWrite(decision: UnderstandDecision): { missed: boolean; reason: keyof typeof NOT_WRITTEN_REASONS | null } {
  const sc = isRec(decision.self_check) ? decision.self_check : null;
  const wrote = (['writes', 'record_ops', 'pending_ops', 'commitment_ops'] as const).some((ch) => arr(decision[ch]).length > 0);
  const clarify = isRec(decision.clarify) ? decision.clarify : null;
  const unwritten = sc?.reported_new_facts === true && !wrote && clarify === null;
  const reason = sc?.not_written_reason;
  const given = typeof reason === 'string' && Object.prototype.hasOwnProperty.call(NOT_WRITTEN_REASONS, reason);
  return { missed: unwritten && !given, reason: unwritten && given ? reason as keyof typeof NOT_WRITTEN_REASONS : null };
}

/** commit.flags about the whole turn (commit.ts §5.1.10 notes, the handler's retry note): not a record. */
export const TURN_FLAG_OP = 'turn';

/**
 * Stage B may not offer a write confirmation ("kaydedeyim mi?", "güncelleyeyim mi?") for what the user
 * just told: nothing was written, no hold anchors such a question, and the user's "evet" would resolve
 * nothing (live trial 2026-10-11). The contract with the handler side is read loosely, so either
 * wiring works: an explicit `unanchoredQuestionForbidden` on the input or on `input.facts`, an issue
 * list on the input (`issues`, ai_turn_log style: { code } or a bare code) naming 'missed_write', the
 * commit's turn flag 'missed_write', or — always — the validator's own rule read off the decision.
 */
export function unanchoredQuestionForbidden(input: CoachInput): boolean {
  const loose = input as unknown as Record<string, unknown>;
  if (loose.unanchoredQuestionForbidden === true) return true;
  if (isRec(loose.facts) && loose.facts.unanchoredQuestionForbidden === true) return true;
  if (arr(loose.issues).some((i) => i === 'missed_write' || (isRec(i) && i.code === 'missed_write'))) return true;
  return missedWriteFlagged(input.commit, input.decision);
}

/** The commit's own turn flag, else the decision (same rule as validateDecision). */
function missedWriteFlagged(commit: CommitResult, decision: UnderstandDecision): boolean {
  return commit.flags.some((f) => f.op === TURN_FLAG_OP && f.code === 'missed_write') || missedWrite(decision).missed;
}

/**
 * A FLAG left by a hold the user CONFIRMED (validate.ts: a confirmed ask issue becomes a flag
 * "kullanıcı onayladı — …"): the question was answered, so it is not a doubt any more. Recognised by
 * the op's own ask-rule code, or by that registry-written prefix for the field-level asks.
 */
const CONFIRMED_ASK_PREFIX = 'kullanıcı onayladı — ';
function isConfirmedAsk(f: { op: string; code: string; note_tr: string }): boolean {
  return f.note_tr.startsWith(CONFIRMED_ASK_PREFIX) || (getOp(f.op)?.rule_docs.ask ?? []).some((r) => r.code === f.code);
}

/** Holds on a value the user typed themselves (not on the model's estimate, like a meal's kcal). */
const USER_VALUE_HOLD_OPS: ReadonlySet<string> = new Set(['body_weight', 'water_log', 'sleep_log', 'step_log']);

/** Today's stored weigh-in window (input.ts LAST_WEIGHT_DAYS): the one the jump check compared with. */
const LAST_WEIGHT_WINDOW_DAYS = 14;

function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The ONE write of `op` this decision proposed (a hold of that op is about it); null if not exactly one. */
function onlyWriteOf(decision: UnderstandDecision, op: string): Record<string, unknown> | null {
  const ws = arr(decision.writes).filter(isRec).filter((w) => w.op === op || findWireOp('writes', w.op)?.type === op);
  return ws.length === 1 ? ws[0] : null;
}

/**
 * The numbers a held write is about, as code knows them (old → new), so the coach's ONE question can
 * show them ("son tartı 78,2 kg → yazdığı 81,6 kg") instead of a bare "doğru mu?". Arithmetic on
 * structured data only: the decision's value and the stored value. An explicit `detail_tr` on the
 * hold (commit side, optional) wins. null when code knows no number for that op.
 */
export function holdNumbers(h: V2Hold, decision: UnderstandDecision, ti: TurnInput): string | null {
  const explicit = (h as V2Hold & { detail_tr?: unknown }).detail_tr;
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit.trim();
  const w = onlyWriteOf(decision, h.op);
  if (!w) return null;
  if (h.op === 'body_weight') {
    const kg = num(w.kg);
    if (kg === null) return null;
    const from = shiftDay(ti.day, -LAST_WEIGHT_WINDOW_DAYS);
    let last: { kg: number; day: string } | null = null;
    for (const x of ti.weights_recent ?? []) {
      const xkg = num(x.kg);
      if (xkg === null || xkg <= 0 || x.day < from || x.day > ti.day) continue;
      if (!last || x.day >= last.day) last = { kg: xkg, day: x.day };
    }
    const stored = last?.kg ?? num(ti.profile.weight_kg);
    const before = stored !== null ? `${last ? 'son tartı' : 'kayıtlı kilo'} ${fmtTr(stored, 1)} kg → ` : '';
    return `${before}yazdığı ${fmtTr(kg, 1)} kg`;
  }
  if (h.op === 'water_log') {
    const ml = mlPerUnit(String(w.unit ?? ''), num(w.other_ml_each));
    const qty = num(w.quantity);
    if (ml === null || qty === null) return null;
    const liters = Math.round((qty * ml) / 10) / 100;
    const day = resolveDay(w.day, ti.day);
    const stored = num(ti.days.find((d) => d.day === day)?.water_liters);
    const said = `yazdığı ${fmtTr(liters, 2)} L (${w.mode === 'set_day_total' ? 'günün toplamı olarak' : 'ekleme olarak'})`;
    return stored !== null ? `kayıtlı ${fmtTr(stored, 2)} L · ${said}` : said;
  }
  if (h.op === 'meal_log') {
    const t = mealTotals(w);
    return t.kcal > 0 ? `öğün ~${fmtTr(Math.round(t.kcal))} kcal` : null;
  }
  return null;
}

/**
 * Holds that §5.2 calls safety holds — allergen/injury removal, goal and band changes, KVKK erase,
 * identity changes. Code appends the template question unless the reply carries it (guarantees.ts).
 * The ONE classifier: commit.ts classes a new hold with it, facts and the post-checks read it.
 */
export const SAFETY_HOLD_OPS: ReadonlySet<string> = new Set([
  'constraint_retract', 'goal_set', 'target_change', 'data_erase_request', 'account_erase_request',
]);
export const SAFETY_HOLD_REASONS: ReadonlySet<string> = new Set([
  'iki_adimli_kaldirma', 'kvkk_onay', 'kimlik_degisimi', 'kimlik_kaniti', 'hedef_degisiyor', 'bant_degisimi',
]);

/** The stored class first (pending_writes.hold_class), else by op / reason code — fail-safe either way. */
export function isSafetyHold(h: V2Hold): boolean {
  return h.hold_class === 'safety' || SAFETY_HOLD_OPS.has(h.op) || SAFETY_HOLD_REASONS.has(h.reason_code);
}

/**
 * One question per reply, except safety: EVERY safety hold's question is asked (code appends the
 * template when the coach does not carry it — a removal the user was never asked about must not be
 * confirmable by a later stray "evet", §5.2). Among ordinary holds only the first is the turn's
 * question, and only when no safety hold is asked; the rest wait. An unasked ordinary hold is safe by
 * construction — it expires and the change simply does not happen.
 */
export function orderHolds(holds: readonly V2Hold[]): V2Hold[] {
  return [...holds.filter(isSafetyHold), ...holds.filter((h) => !isSafetyHold(h))];
}

function refSummary(ref: string, refs: RenderedRefs): string {
  const r = refs[ref];
  return r?.summary_tr ? `${ref} (${quoteLine(r.summary_tr, 80)})` : ref;
}

/** Severe-or-unknown allergen subjects of the user's spine (the exposure line's "ciddi" mark). */
function severeSet(ti: TurnInput): Set<string> {
  const spine = allergenSpine(ti.constraints.map((c) => ({ kind: c.kind, subject: c.subject, severity: c.severity })));
  return new Set(spine.severe.map((s) => s.toLocaleLowerCase('tr')));
}

/** What a missed write tells the coach: nothing saved, no hold — say so, ask openly, offer no "yes". */
export const MISSED_WRITE_LINE = '- Kayıt yok: kullanıcı kendisi hakkında yeni bir şey söyledi ama hiçbir şey kaydedilmedi ve bunun için bekleyen bir onay yok. Kaydetmediğini açıkça söyle ve ne olduğunu açık uçlu sor; "kaydedeyim mi?", "güncelleyeyim mi?" gibi bir onay teklif etme, arkasında bekleyen kayıt olmadığı için "evet" hiçbir şeyi değiştirmez';
/** The same fact on a turn where something else did happen (a stale/loose flag never claims "Kayıt yok"). */
export const MISSED_WRITE_ALSO_LINE = '- Kullanıcının söylediklerinden yukarıda görünmeyen bir şey kaydedilmedi; onun için onay teklif etme (bekleyen kayıt yok), gerekirse açık uçlu sor';

/**
 * The receipts/holds/rejects/flags/exposures of this turn as fact lines. A failed receipt that a
 * reject already explains is not listed twice (the reject carries the reason). On a safety turn
 * (`safetyTurn`: any tripwire resolution other than normal) no hold is the turn's question — a
 * portion or settings question next to a crisis or an ED signal does harm; the hold simply waits.
 * `forbidUnanchored` is unanchoredQuestionForbidden(input) when the caller has the whole input;
 * left out, it is derived from the commit flag / the decision.
 */
export function renderTurnEvents(
  ti: TurnInput, decision: UnderstandDecision, commit: CommitResult, safetyTurn = false, forbidUnanchored?: boolean,
): string[] {
  const lines: string[] = [];
  const rejectsLeft = new Map<string, number>();
  for (const r of commit.rejects) rejectsLeft.set(r.op, (rejectsLeft.get(r.op) ?? 0) + 1);
  const explainedByReject = (r: V2Receipt): boolean => {
    for (const key of [r.action_type, r.legacy_type]) {
      const n = rejectsLeft.get(key) ?? 0;
      if (n > 0) { rejectsLeft.set(key, n - 1); return true; }
    }
    return false;
  };

  for (const r of commit.receipts) {
    if (r.ok) {
      lines.push(`- KAYDEDİLDİ: ${r.user_line ?? opTitle(r.action_type)}`);
    } else if (!explainedByReject(r)) {
      lines.push(`- KAYDEDİLEMEDİ (teknik hata, ${r.failure_class ?? 'bilinmiyor'}): ${r.user_line ?? opTitle(r.action_type)}`);
    }
  }
  for (const f of commit.flags) {
    // Turn-level notes are not records: §5.1.10 is rendered below from the same rule, a declared
    // not-written reason from the decision; anything else (the retry note) as the plain fact it is.
    if (f.op === TURN_FLAG_OP) {
      if (f.code !== 'missed_write' && !f.code.startsWith('not_written:')) lines.push(`- Not: ${f.note_tr}`);
      continue;
    }
    // A confirmed hold: the user answered its question, so its reason is no longer a doubt to repeat.
    if (isConfirmedAsk(f)) {
      const detail = f.note_tr.startsWith(CONFIRMED_ASK_PREFIX) ? f.note_tr.slice(CONFIRMED_ASK_PREFIX.length) : f.note_tr;
      lines.push(`- ONAYLANDI (${opTitle(f.op)}): kullanıcı doğruladı ve kayıt yazıldı (${detail}); kesinleşti, yeniden sorgulama`);
      continue;
    }
    lines.push(`- KAYDEDİLDİ AMA BELİRSİZ (${opTitle(f.op)}): ${f.note_tr}`);
  }
  const ordered = orderHolds(commit.holds);
  const anySafety = ordered.some(isSafetyHold);
  ordered.forEach((h, i) => {
    const nums = holdNumbers(h, decision, ti);
    const what = `- BEKLETİLDİ, yazılmadı (${HOLD_OP_TR[h.op] ?? opTitle(h.op)}): kullanıcının onayı gerekiyor${nums ? ` (${nums})` : ''}`;
    lines.push(safetyTurn
      ? `${what}; bu bir güvenlik turu, bu turda sorulmaz ("${h.question_tr}")`
      : isSafetyHold(h)
      // §5.2/§7.1: a safety hold's question is code's — guarantees.ts appends the template verbatim at
      // the end unless the reply already carries it, so the coach's own paraphrase would only ask it twice.
      ? `${what}; bu bir güvenlik onayı, sorusunu kod cevabın sonuna aynen ekler: "${h.question_tr}" Bu soruyu kendin tekrar sorma ve başka soru ekleme; istersen neden beklettiğini yarım cümleyle söyle`
      : i === 0 && !anySafety
      // The template is the question's MEANING; the coach asks it in its own words, with the numbers —
      // and a value the USER typed (a weigh-in, a water amount) is asked about what they wrote
      // ("doğru mu yazdın?"), not about the coach ("doğru mu yazdım?", live trial 2026-10-11).
      ? `${what}; sorulacak tek soru: "${h.question_tr}" Bunu kendi sözlerinle${nums ? ', sayılarıyla' : ''} sor${USER_VALUE_HOLD_OPS.has(h.op) ? '; soru kişinin yazdığı değer hakkında ("doğru mu yazdın?")' : ''}`
      : `${what}; bu turun sorusu yukarıdaki, bunu sonraki bir turda sor ("${h.question_tr}")`);
  });
  for (const r of commit.rejects) lines.push(`- REDDEDİLDİ, yazılmadı (${opTitle(r.op)}): ${r.reason_tr}`);

  const severe = severeSet(ti);
  for (const e of commit.exposures) {
    const isSevere = e.allergens.some((a) => severe.has(a.toLocaleLowerCase('tr')));
    const what = e.source === 'supplement' ? 'takviye' : 'öğün';
    lines.push(`- ALERJEN ÇAKIŞMASI: kaydedilen ${what} (${e.ref}) profildeki ${e.allergens.map(vocabLabel).join(', ')} ${isSevere ? 'alerjisiyle (ciddi)' : 'hassasiyetiyle'} çakışıyor; kayıt yapıldı ve cevapta anılması gerekiyor`);
  }

  const clarify = isRec(decision.clarify) ? decision.clarify : null;
  if (clarify) {
    const refs = turnRefs(ti).rendered;
    const cands = arr(clarify.candidate_refs).filter((r): r is string => typeof r === 'string').map((r) => refSummary(r, refs));
    lines.push(`- NETLEŞTİRME GEREKİYOR: ${quoteLine(String(clarify.topic ?? ''), 160)}${cands.length ? `; adaylar: ${cands.join(', ')}` : ''}`);
  }

  const missed = forbidUnanchored ?? missedWriteFlagged(commit, decision);
  if (lines.length === 0) {
    const m = missedWrite(decision);
    if (missed && safetyTurn) {
      // Next to a crisis or an emergency no data-entry question is asked, open or not.
      lines.push('- Kayıt yok (güvenlik turu; kayıt konusu açılmaz)');
    } else if (missed) {
      lines.push(MISSED_WRITE_LINE);
    } else if (m.reason) {
      lines.push(`- Kayıt yok (bilinçli: ${NOT_WRITTEN_REASONS[m.reason]})`);
    } else {
      lines.push('- Kayıt yok');
    }
  } else if (missed && !safetyTurn && !commit.holds.length) {
    lines.push(MISSED_WRITE_ALSO_LINE);
  }
  return lines;
}

/** Stage A's reading of the message that Stage B needs as context (ED signal, plan, simulation). */
export function renderDecisionFacts(decision: UnderstandDecision, budget: BudgetFacts | null): string[] {
  const lines: string[] = [];
  const safety = isRec(decision.safety) ? decision.safety : null;
  const ed = safety && isRec(safety.ed_signal) ? safety.ed_signal : null;
  if (ed && typeof ed.category === 'string') {
    const cat = (ED_CATEGORIES as Record<string, string>)[ed.category] ?? ed.category;
    lines.push(ed.category === 'illness_vomiting'
      ? `- Okuma: ${cat}; yeme bozukluğu sinyali değil`
      : `- Okuma: yeme bozukluğu sinyali (${cat}, şiddet ${String(ed.severity ?? '?')})`);
  }
  const plan = isRec(decision.plan_action) ? decision.plan_action : null;
  if (plan && typeof plan.op === 'string' && plan.op !== 'none') {
    const label = (PLAN_OPS as Record<string, string>)[plan.op] ?? plan.op;
    lines.push(`- Plan isteği okundu: ${label}${typeof plan.plan_type === 'string' ? ` (${planTypeTr(plan.plan_type)})` : ''}; bu turda taslak üretimi bu bloğa yazılmadıysa yapılmadı`);
  }
  const sim = isRec(decision.simulation) ? decision.simulation : null;
  const kcal = sim ? num(sim.kcal_estimate) : null;
  if (sim && kcal !== null) {
    const day = typeof sim.target_day === 'string' ? sim.target_day : null;
    let tail = '';
    if (budget && budget.certain && budget.band && (day === null || day === budget.day)) {
      const after = budget.consumedKcal + kcal;
      tail = after > budget.band.max
        ? `; yerse bugün üst sınırı ${fmtTr(after - budget.band.max)} kcal aşar (sunucu hesabı)`
        : `; yerse bugün ${fmtTr(after)} kcal olur, üst sınıra ${fmtTr(budget.band.max - after)} kcal kalır (sunucu hesabı)`;
    } else if (day !== null && budget && day !== budget.day) {
      tail = `; ${day} günü için sunucu bütçe sayısı yok`;
    }
    lines.push(`- Varsayım sorusu: ${quoteLine(String(sim.food ?? ''), 80)} ~${fmtTr(Math.round(kcal))} kcal (tahmin)${tail}`);
  }
  return lines;
}

/** GÜVENLİK DURUMU: only when the resolution changes the turn (protective path or fail-closed fallback). */
export function renderTripwireFacts(t: TripwireResolution): string[] {
  const CAT: Record<string, string> = { emergency: 'acil tıbbi durum', self_harm: 'kendine zarar', ed: 'yeme bozukluğu' };
  if (t.kind === 'protective') {
    return [
      `- Bu mesajda ${t.categories.map((c) => CAT[c] ?? c).join(', ')} işareti var; koruyucu yol geçerli (${t.route === 'crisis' ? 'kriz' : 'yeme bozukluğu desteği'} sözleşmesi).`,
      `- Cevapta bulunması gereken satırın anlamı: "${t.required_line}" (yoksa kod sona ekler).`,
    ];
  }
  if (t.kind === 'fallback' && t.mode === 'append') {
    return [`- Bu mesajda ${CAT[t.category] ?? t.category} işareti okunamadı; uzman yönlendirmesi cevabın sonuna kodla eklenecek.`];
  }
  return [];
}

/** Everything code tells Stage B about THIS turn, in §3.2 T6 order. */
export interface StageBFacts {
  state: string[];
  extra: string[];
  turn: string[];
  safety: string[];
  budget: BudgetFacts;
  /** No write-confirmation offer this turn: the user's fact was not written and no hold backs a "yes". */
  unanchoredQuestionForbidden: boolean;
}

export function buildStageBFacts(input: CoachInput): StageBFacts {
  const ti = input.turnInput;
  const budget = budgetFacts(ti, turnIntakeDelta(ti, input.decision, input.commit));
  const forbid = unanchoredQuestionForbidden(input);
  return {
    state: renderUserState(ti, budget),
    extra: input.userState.filter((l) => typeof l === 'string' && l.trim() !== ''),
    turn: [...renderTurnEvents(ti, input.decision, input.commit, input.tripwire.kind !== 'normal', forbid), ...renderDecisionFacts(input.decision, budget)],
    safety: renderTripwireFacts(input.tripwire),
    budget,
    unanchoredQuestionForbidden: forbid,
  };
}

/** The facts as the prompt text blocks (headings + lines). */
export function renderStageBFacts(f: StageBFacts): string {
  const blocks: string[] = [`${FACT_BLOCK_TITLES.state}\n${f.state.join('\n')}`];
  if (f.extra.length > 0) blocks.push(`${FACT_BLOCK_TITLES.extra}\n${f.extra.join('\n')}`);
  blocks.push(`${FACT_BLOCK_TITLES.turn}\n${f.turn.join('\n')}`);
  if (f.safety.length > 0) blocks.push(`${FACT_BLOCK_TITLES.safety}\n${f.safety.join('\n')}`);
  return blocks.join('\n\n');
}

/** Turkish label of an allergen/body-part id for the user-facing lines ('peanut' → 'yer fıstığı'). */
export function vocabLabel(id: string): string {
  return (vocab.ALLERGENS as Record<string, string>)[id]?.split(' (')[0]
    ?? (vocab.BODY_PARTS as Record<string, string>)[id]
    ?? id;
}
