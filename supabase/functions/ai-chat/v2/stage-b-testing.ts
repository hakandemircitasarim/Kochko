/**
 * ai-chat/v2/stage-b-testing.ts — fixtures for the Stage B / postcheck / envelope tests (no network,
 * no database). Imported only by *.test.ts files.
 *
 *   seededTurnInput   the realistic seed user of testing.ts through the real loader (today 2026-10-07:
 *                     m2 kahvaltı + m3 öğle = 675 kcal, plan 1500–1700, c1 fıstık ciddi, c2 sol diz, p1 …)
 *   decision()        a complete understanding envelope with nothing to write (override what a test needs)
 *   commit()          an empty CommitResult (override receipts/holds/rejects/flags/exposures)
 *   tripwires         normal / protective (by Stage A positive) / fail-closed fallback resolutions
 *   replyJson()       a full strict 'kochko_reply_vN' object
 *   stageBTransport   one fake Responses transport answering the coach and the luna judge by schema name
 */
import { CANNED_SAFETY, resolveTripwires, scanTripwires, type SafetyCategory } from '../../shared/safety-tripwires.ts';
import type { CoachInput, CommitResult, CoachReply, TripwireResolution, UnderstandDecision } from './contracts.ts';
import { loadTurnInput, type TurnInput } from './input.ts';
import { fakeResponses, fakeTurnInputDb, NOW, responsesBody, seedTables, USER } from './testing.ts';
import type { DbRow } from './input.ts';

export { NOW, USER };

export async function seededTurnInput(mutate?: (tables: Record<string, DbRow[]>) => void): Promise<TurnInput> {
  const tables = seedTables();
  mutate?.(tables);
  return await loadTurnInput(fakeTurnInputDb(tables), { userId: USER, now: NOW });
}

export function decision(over: Partial<UnderstandDecision> = {}): UnderstandDecision {
  return {
    intent: { primary: 'chat', is_hypothetical: false, about_other_person: false },
    safety: { acute_medical: false, self_harm: false, ed_signal: null, tripwire_readings: [] },
    writes: [],
    record_ops: [],
    pending_ops: [],
    commitment_ops: [],
    plan_action: { op: 'none', plan_type: null, draft_ref: null },
    simulation: null,
    clarify: null,
    reply_route: { contract: 'coach', effort_hint: 'low' },
    self_check: { reported_new_facts: false, not_written_reason: null },
    ...over,
  };
}

export function commit(over: Partial<CommitResult> = {}): CommitResult {
  return { turnId: 'turn-test-1', receipts: [], holds: [], rejects: [], flags: [], writtenRefs: [], exposures: [], ...over };
}

/** A meal_log write as Stage A emits it (one item per [name, kcal, protein]). */
export function mealWrite(items: Array<[string, number, number]>, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    op: 'meal_log', day: 'today', meal_type: 'dinner', time_local: null, raw: items.map((i) => i[0]).join(', '), status: 'new',
    venue: null, replaces: null,
    items: items.map(([name, kcal, protein]) => ({
      name, as_stated: '1 porsiyon', grams: null, kcal, protein_g: protein, carbs_g: 10, fat_g: 5, alcohol_g: 0, caffeine_mg: 0,
      preparation: null, allergens: [], may_contain: [], reference_key: null, confidence: 0.8,
    })),
    ...over,
  };
}

export function normalTripwire(message = 'merhaba'): TripwireResolution {
  return resolveTripwires({ scan: scanTripwires(message), stageA: { status: 'ok', readings: [], positives: [] } });
}

/** A protective resolution from a Stage A positive (the path that catches what the lists miss). */
export function protectiveTripwire(category: SafetyCategory): TripwireResolution {
  return resolveTripwires({
    scan: scanTripwires('merhaba'),
    stageA: { status: 'ok', readings: [], positives: [{ category, ed_severity: category === 'ed' ? 'medium' : null }] },
  });
}

/** Stage A failed with a live ED trigger: coaching continues, the referral is appended (§7.2). */
export function edFallbackTripwire(): TripwireResolution {
  const log = normalTripwire().log;
  return { kind: 'fallback', category: 'ed', response: CANNED_SAFETY.ed_medium, mode: 'append', ed_signal: 'medium', log: { ...log, outcome: 'fallback' } };
}

export function coachInput(ti: TurnInput, over: Partial<CoachInput> = {}): CoachInput {
  return {
    turnInput: ti,
    message: 'akşam ne yesem?',
    decision: decision(),
    commit: commit(),
    tripwire: normalTripwire(),
    history: [],
    userState: [],
    ...over,
  };
}

export function replyJson(over: Partial<CoachReply> = {}): CoachReply {
  return {
    suggested_foods: [],
    suggested_exercises: [],
    reply: 'Akşam için ızgara tavuk ve bol salata iyi gider; tabağın yarısı sebze olsun.',
    why: 'Bugün proteinin hedefin altında.',
    memory: [],
    ui: { navigate_to: null, task_completion_summary: null },
    referral_included: false,
    ...over,
  };
}

export interface StageBScript {
  /** Coach replies in call order (the last one repeats). A Response is sent as is (errors, refusals). */
  coach: Array<CoachReply | Response>;
  /** Judge answers in call order (the last one repeats). */
  judge?: Array<{ violation: boolean; items: unknown[] } | Response>;
}

/** One transport for both models, routed by the strict schema name in the request body. */
export function stageBTransport(script: StageBScript) {
  let c = 0;
  let j = 0;
  const pick = <T>(list: T[], i: number): T => list[Math.min(i, list.length - 1)];
  const fake = fakeResponses((call) => {
    const name = ((call.body.text as Record<string, unknown> | undefined)?.format as Record<string, unknown> | undefined)?.name;
    if (name === 'kochko_judge_v1') {
      const a = pick(script.judge ?? [{ violation: false, items: [] }], j++);
      return a instanceof Response ? a : responsesBody(a);
    }
    const a = pick(script.coach, c++);
    return a instanceof Response ? a : responsesBody(a);
  });
  return {
    transport: fake.transport,
    calls: fake.calls,
    coachCalls: () => fake.calls.filter((x) => ((x.body.text as Record<string, unknown>)?.format as Record<string, unknown>)?.name !== 'kochko_judge_v1'),
    judgeCalls: () => fake.calls.filter((x) => ((x.body.text as Record<string, unknown>)?.format as Record<string, unknown>)?.name === 'kochko_judge_v1'),
  };
}
