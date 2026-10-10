/**
 * Stage A request for a fixture — built by PRODUCTION's composer, not a look-alike.
 *
 * The only eval-side step is mapping the fixture's TurnInput snapshot (a loose superset with
 * pre-rendered record lines, types.ts) to the StageATurnView that ai-chat/v2/stage-a-request.ts
 * renders — the same view input.ts stageAView builds from a live TurnInput. Structured parts are
 * worded by input.ts's own helpers (profile phrases, constraint lines, plan type, Turkish numbers),
 * so a fixture and a live turn with the same facts read the same. Everything else is imported:
 *   - T2: scanTripwires(message) from shared/safety-tripwires.ts — the facts Stage A reads and the
 *     explicit hits that never reach Stage A (resolveTripwires → canned reply, no LLM call);
 *   - the prefix (understand-prompt rules + registry doc + few-shots), the strict schema
 *     (buildUnderstandSchema), the cache key, the §8.4 effort and max_tokens: buildStageARequest().
 *
 * The body IS what ai-decide accepts, and its sha256 is the replay key — so a prompt, schema,
 * few-shot or registry change is a different key and an old recording can never be graded
 * against new bytes. Deterministic: no clock, no randomness, stable ordering.
 */
import type { EvalFixture, FixtureTurnInput, Json, ReferenceCandidate } from './types.ts';
import { buildStageARequest, renderTurnInputBlock as renderView, type StageARequest, type StageATurnView } from '../stage-a-request.ts';
import { constraintLine, fmtTr, planTypeTr, profilePhrases } from '../input.ts';
import { resolveTripwires, scanTripwires, tripwireFacts, type TripwireDecision, type TripwireScan } from '../../../shared/safety-tripwires.ts';

const val = (v: Json): string => (typeof v === 'string' ? v : JSON.stringify(v));

/**
 * BUGÜN totals as the loader words them — the wording the few-shots teach ("BUGÜN: su 1,40 L").
 * A key without a Turkish label is shown as key=value (never dropped).
 */
export function todayPhrases(today: Readonly<Record<string, Json>>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(today)) {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : null;
    if (k === 'water_liters' && n !== null) out.push(`su ${fmtTr(n, 2)} L`);
    else if (k === 'kcal' && n !== null) out.push(`${fmtTr(Math.round(n))} kcal`);
    else if (k === 'protein_g' && n !== null) out.push(`protein ${fmtTr(Math.round(n))} g`);
    else if (k === 'meals_logged' && n !== null) out.push(`${n} öğün kaydı`);
    else out.push(`${k}=${val(v)}`);
  }
  return out;
}

/**
 * What the TurnInput renderer reads from a fixture. Reference rows need only `key` + `line` here:
 * their numbers are the validator's ReferenceRow, never rendered (fixtures still must carry them —
 * fixtures.ts lint).
 */
export type RenderableTurnInput = Omit<FixtureTurnInput, 'reference_candidates'> & {
  reference_candidates?: ReadonlyArray<Pick<ReferenceCandidate, 'key' | 'line'>>;
};

/** A fixture's goal facts live in its profile (goal_type, target_weight_kg); null when it states none. */
export function fixtureGoal(profile: Readonly<Record<string, Json>>): Record<string, Json> | null {
  return profile.goal_type !== undefined || profile.target_weight_kg !== undefined
    ? { goal_type: profile.goal_type ?? null, target_weight_kg: profile.target_weight_kg ?? null }
    : null;
}

/** Fixture snapshot → the view production renders. */
export function fixtureView(ti: RenderableTurnInput): StageATurnView {
  const day = ti.now?.local_date ?? '1970-01-01';
  const profile = ti.profile ?? {};
  return {
    now: { today: day, local_date: day, local_time: ti.now?.local_time ?? null, tz: ti.now?.tz ?? null },
    ed_tier: ti.tier ?? 'none',
    profile: profilePhrases(profile, fixtureGoal(profile), { rest: true }),
    gates: ti.gates ?? [],
    today: todayPhrases(ti.today ?? {}),
    records: (ti.records ?? []).map((r) => ({ ref: r.ref, line: r.line, last_turn: r.last_turn === true })),
    constraints: (ti.spine ?? []).map((c) => ({
      ref: c.ref,
      line: constraintLine({
        kind: c.kind, subject: c.display_tr, severity: c.severity ?? null, body_parts: c.body_parts, note: c.note ?? null,
        whose: c.whose ?? 'self', active: c.active,
      }),
    })),
    pending: (ti.pending ?? []).map((p) => ({ ref: p.ref, line: `${p.op} · ${p.line}` })),
    commitments: (ti.commitments ?? []).map((k) => ({ ref: k.ref, line: k.line })),
    drafts: ti.draft ? [{ ref: ti.draft.ref, line: `${planTypeTr(ti.draft.plan_type)} taslağı v${ti.draft.version} · ${ti.draft.line}` }] : [],
    active_plans: [],
    references: (ti.reference_candidates ?? []).map((c) => ({ key: c.key, line: c.line })),
    image: ti.image === true,
    last_turn_writes: [],
    history: (ti.history ?? []).map((h) => ({ role: h.role, content: h.content, receipts: h.receipts ?? [] })),
  };
}

/**
 * The TurnInput block Stage A reads for a fixture: the fixture mapped to the view, rendered by
 * PRODUCTION's renderer (stage-a-request.ts).
 */
export function renderTurnInputBlock(ti: RenderableTurnInput): string {
  return renderView(fixtureView(ti));
}

export interface FixtureT2 {
  scan: TripwireScan;
  /** resolveTripwires with no Stage A: `canned` = the explicit list answers, Stage A is never called. */
  floor: TripwireDecision;
  /** The `t2` result root. */
  output: { canned: boolean; category: string | null; explicit: string | null; hits: unknown[]; facts: number };
}

export function fixtureT2(message: string): FixtureT2 {
  const scan = scanTripwires(message);
  const floor = resolveTripwires({ scan, stageA: null });
  return {
    scan,
    floor,
    output: {
      canned: floor.kind === 'canned',
      category: floor.kind === 'canned' ? floor.category : null,
      explicit: scan.explicit?.trigger ?? null,
      hits: scan.hits.map((h) => ({ hit_id: h.hit_id, trigger: h.trigger, category: h.category, tier: h.tier, negated: h.negated })),
      facts: tripwireFacts(scan).length,
    },
  };
}

/** The ai-decide body for one fixture (= production's Stage A request). */
export function buildFixtureRequest(fixture: EvalFixture, model: string, scan = scanTripwires(fixture.message)): StageARequest {
  return buildStageARequest({ view: fixtureView(fixture.turn_input), scan, message: fixture.message, model });
}
