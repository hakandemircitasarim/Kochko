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
 * The missed-write question (§5.1.10) appears ONLY when Stage A's self_check reported new facts,
 * nothing was written or clarified, and no CLOSED reason (NOT_WRITTEN_REASONS) was given; a declared
 * reason is rendered as the reason itself, so an emergency or illness turn never ends with a
 * data-entry question.
 *
 * Pure: no I/O, no clock, no reading of the user's words (the message is only placed by coach.ts).
 */
import type { CoachInput, CommitResult, TripwireResolution, UnderstandDecision, V2Hold, V2Receipt } from './contracts.ts';
import { constraintLine, edTierOf, planTypeTr, profilePhrases, turnRefs, type TurnInput } from './input.ts';
import { dayLabelTr, fmtTr, quoteLine } from './stage-a-request.ts';
import {
  ED_CATEGORIES, getOp, mlPerUnit, NOT_WRITTEN_REASONS, PLAN_OPS, type RenderedRefs, vocab,
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
    parts.push(`${fmtTr(b.consumedKcal)} kcal (bu turdan önceki toplam; bu turdaki değişiklik koda göre kesinleşmedi, kalan sayısı yok)`);
  } else {
    parts.push(`${fmtTr(b.consumedKcal)} kcal${b.includesThisTurn ? ' (bu turdaki kayıtlar dahil)' : ''}`);
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

/** Holds that §5.2 calls safety holds (code adds the template question when the coach does not ask). */
export const SAFETY_HOLD_OPS: ReadonlySet<string> = new Set(['constraint_retract', 'data_erase_request', 'account_erase_request', 'target_change']);
export const SAFETY_HOLD_REASONS: ReadonlySet<string> = new Set([
  'iki_adimli_kaldirma', 'kvkk_onay', 'kimlik_degisimi', 'kimlik_kaniti', 'hedef_degisiyor', 'bant_degisimi',
]);

export function isSafetyHold(h: V2Hold): boolean {
  return SAFETY_HOLD_OPS.has(h.op) || SAFETY_HOLD_REASONS.has(h.reason_code);
}

/**
 * One question per reply: the FIRST hold of this order is the turn's question (safety holds first,
 * then commit order); the rest wait. An unasked hold is safe by construction — it expires and the
 * change simply does not happen.
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

/**
 * The receipts/holds/rejects/flags/exposures of this turn as fact lines. A failed receipt that a
 * reject already explains is not listed twice (the reject carries the reason). On a safety turn
 * (`safetyTurn`: any tripwire resolution other than normal) no hold is the turn's question — a
 * portion or settings question next to a crisis or an ED signal does harm; the hold simply waits.
 */
export function renderTurnEvents(ti: TurnInput, decision: UnderstandDecision, commit: CommitResult, safetyTurn = false): string[] {
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
  for (const f of commit.flags) lines.push(`- KAYDEDİLDİ AMA BELİRSİZ (${opTitle(f.op)}): ${f.note_tr}`);
  orderHolds(commit.holds).forEach((h, i) => {
    const what = `- BEKLETİLDİ, yazılmadı (${HOLD_OP_TR[h.op] ?? opTitle(h.op)}): kullanıcının onayı gerekiyor`;
    lines.push(safetyTurn
      ? `${what}; bu bir güvenlik turu, bu turda sorulmaz ("${h.question_tr}")`
      : i === 0
      ? `${what}; sorulacak tek soru: "${h.question_tr}"`
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

  if (lines.length === 0) {
    const m = missedWrite(decision);
    if (m.missed) {
      lines.push('- Kayıt yok: kullanıcı yeni bir şey bildirdi ama hiçbir şey yazılmadı ve bunun bir gerekçesi yok; ne olduğunu sor, yazılmış gibi davranma');
    } else if (m.reason) {
      lines.push(`- Kayıt yok (bilinçli: ${NOT_WRITTEN_REASONS[m.reason]})`);
    } else {
      lines.push('- Kayıt yok');
    }
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
}

export function buildStageBFacts(input: CoachInput): StageBFacts {
  const ti = input.turnInput;
  const budget = budgetFacts(ti, turnIntakeDelta(ti, input.decision, input.commit));
  return {
    state: renderUserState(ti, budget),
    extra: input.userState.filter((l) => typeof l === 'string' && l.trim() !== ''),
    turn: [...renderTurnEvents(ti, input.decision, input.commit, input.tripwire.kind !== 'normal'), ...renderDecisionFacts(input.decision, budget)],
    safety: renderTripwireFacts(input.tripwire),
    budget,
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
