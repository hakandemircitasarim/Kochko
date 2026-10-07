/**
 * Stage A request for a fixture — built by PRODUCTION's composer, not a look-alike.
 *
 * The only eval-side step is mapping the fixture's TurnInput snapshot (a loose superset with
 * pre-rendered lines, types.ts) to the StageATurnView that ai-chat/v2/stage-a-request.ts renders.
 * Everything else is imported:
 *   - T2: scanTripwires(message) from shared/safety-tripwires.ts — the facts Stage A reads and the
 *     explicit hits that never reach Stage A (resolveTripwires → canned reply, no LLM call);
 *   - the prefix (understand-prompt rules + registry doc + few-shots), the strict schema
 *     (buildUnderstandSchema), the cache key and the §8.4 effort: buildStageARequest().
 *
 * The body IS what ai-decide accepts, and its sha256 is the replay key — so a prompt, schema,
 * few-shot or registry change is a different key and an old recording can never be graded
 * against new bytes. Deterministic: no clock, no randomness, stable ordering.
 */
import type { EvalFixture, FixtureTurnInput, Json, ReferenceCandidate } from './types.ts';
import { buildStageARequest, renderTurnInputBlock as renderView, type StageARequest, type StageATurnView } from '../stage-a-request.ts';
import { resolveTripwires, scanTripwires, tripwireFacts, type TripwireDecision, type TripwireScan } from '../../../shared/safety-tripwires.ts';

const val = (v: Json): string => (typeof v === 'string' ? v : JSON.stringify(v));

/** Turkish number as the loader prints it: fixed decimals, decimal comma ("1,40"). */
const trNum = (n: number, digits: number) => n.toFixed(digits).replace('.', ',');

/**
 * BUGÜN totals as the loader prints them — the wording the few-shots teach ("BUGÜN: su 1,40 L").
 * A key without a Turkish label is shown as key=value (never dropped).
 */
export function todayPhrases(today: Readonly<Record<string, Json>>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(today)) {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : null;
    if (k === 'water_liters' && n !== null) out.push(`su ${trNum(n, 2)} L`);
    else if (k === 'kcal' && n !== null) out.push(`${Math.round(n)} kcal`);
    else if (k === 'protein_g' && n !== null) out.push(`protein ${Math.round(n)} g`);
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

/** Fixture snapshot → the view production renders (spine rows formatted as the loader would). */
export function fixtureView(ti: RenderableTurnInput): StageATurnView {
  const now = ti.now ?? { local_date: '1970-01-01' };
  return {
    now: { local_date: now.local_date, weekday_tr: now.weekday_tr ?? null, local_time: now.local_time ?? null, tz: now.tz ?? null },
    ed_tier: ti.tier ?? 'none',
    profile: Object.entries(ti.profile ?? {}).map(([k, v]) => [k, val(v)] as const),
    constraints: (ti.spine ?? []).map((c) => {
      const bits = [c.kind, c.display_tr, c.severity ?? 'unknown', c.whose ?? 'self', c.active === false ? 'PASİF (geri alındı)' : 'aktif'];
      if (c.body_parts?.length) bits.push(`bölge: ${c.body_parts.join(',')}`);
      if (c.note) bits.push(`not: "${c.note}"`);
      return { ref: c.ref, line: bits.join(' · ') };
    }),
    records: (ti.records ?? []).map((r) => ({ ref: r.ref, line: r.line, last_turn: r.last_turn === true })),
    today: todayPhrases(ti.today ?? {}),
    pending: (ti.pending ?? []).map((p) => ({ ref: p.ref, line: `${p.op} · ${p.line}` })),
    commitments: (ti.commitments ?? []).map((k) => ({ ref: k.ref, line: k.line })),
    draft: ti.draft ? { ref: ti.draft.ref, line: `${ti.draft.plan_type} v${ti.draft.version} · ${ti.draft.line}` } : null,
    gates: ti.gates ?? [],
    references: (ti.reference_candidates ?? []).map((c) => ({ key: c.key, line: c.line })),
    image: ti.image === true,
    history: (ti.history ?? []).map((h) => ({ role: h.role, content: h.content, receipts: h.receipts ?? [] })),
  };
}

/**
 * The TurnInput block Stage A reads for a fixture: the fixture mapped to the view, rendered by
 * PRODUCTION's renderer (stage-a-request.ts). Kept under this name so the brain's tests check
 * their few-shot labels against the real renderer through the fixture shape.
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
