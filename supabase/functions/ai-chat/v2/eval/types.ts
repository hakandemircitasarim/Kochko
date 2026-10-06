/**
 * v2 eval harness — shared types (docs/AI_MIMARI_V2.md §9).
 *
 * Pure declarations, no I/O. A fixture is DATA: a TurnInput snapshot, one user message and
 * machine-checkable expectations over named result roots. The runner never interprets the user
 * message; it only builds a request, sends it through a transport port and evaluates paths.
 *
 * Why roots instead of one blob: the v2 pipeline lands in pieces (Stage A first, then the
 * validator, commit simulation, Stage B, envelope). An expectation on a stage that has not run yet
 * is SKIPPED, never failed, so the same fixture file keeps working as the stages arrive.
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** §9.4 packages. ASCII ids so they survive shells and JSON keys. */
export type PackageId = 'A' | "A'" | 'B+' | 'B-' | 'C' | 'D' | 'E';
export const PACKAGE_IDS: readonly PackageId[] = ['A', "A'", 'B+', 'B-', 'C', 'D', 'E'];

/** Result roots an expectation path may start with; each one is produced by exactly one stage. */
export type StageRoot =
  | 'decision' //   Stage A strict-schema output (kochko_understand_vN)
  | 'validation' // validateDecision: per-write commit | flag | ask | reject
  | 'commit' //     simulated commit: derive() output per op (e.g. commit.water_log.liters)
  | 'receipts' //   typed receipts {action_type, ok, user_line, failure_class, ...}
  | 'reply' //      Stage B kochko_reply_vN (reply, suggested_foods, suggested_exercises, ...)
  | 'envelope' //   renderEnvelope → TurnEnvelope the client reads
  | 'facts' //      Stage B facts block ("BU TURDA OLANLAR", budget, agenda)
  | 'report' //     ai-report output (pipeline 'report')
  | 'plan' //       plan pipeline output (pipeline 'plan')
  | 'meta'; //      latency, usage, cache class
export const STAGE_ROOTS: readonly StageRoot[] = [
  'decision', 'validation', 'commit', 'receipts', 'reply', 'envelope', 'facts', 'report', 'plan', 'meta',
];

/** Which pipeline a fixture exercises. Only 'chat' runs through Stage A today. */
export type FixturePipeline = 'chat' | 'report' | 'plan';

// ── TurnInput snapshot (fixture side) ───────────────────────────────────────────────────────────
// Deliberately a loose superset of what ai-chat/v2/input.ts will serialize: integration maps it
// with one converter. Refs are the short tokens of §4.2 (m12, d3, c1, p1, k1, dft1).

export interface SpineEntry {
  ref: string;
  kind: string; // allergen | intolerance | injury | condition | medication | dietary
  subject_id: string;
  display_tr: string;
  severity?: string; // mild | moderate | severe | unknown
  whose?: string; // self | other_person
  active?: boolean;
  body_parts?: string[];
  note?: string;
}

export interface RecordLine {
  ref: string;
  kind: string; // meal | water | workout | sleep | weight | supplement | mood | steps | venue | profile
  day: string; // YYYY-MM-DD
  line: string; // rendered one-liner, exactly what Stage A would read
  last_turn?: boolean;
}

export interface PendingLine { ref: string; op: string; line: string }
export interface CommitmentLine { ref: string; line: string }
export interface DraftLine { ref: string; plan_type: 'diet' | 'workout'; version: number; line: string }
export interface HistoryTurn { role: 'user' | 'assistant'; content: string; receipts?: string[] }
/** A T2 tripwire hit handed to Stage A as a FACT (§3.2 T2); code computes these, fixtures declare them. */
export interface TripwireHit { id: string; list: 'explicit' | 'ambiguous' | 'injection'; category: string; match: string }
export interface ReferenceCandidate { key: string; line: string }

export interface FixtureTurnInput {
  now?: { local_date: string; local_time?: string; weekday_tr?: string; tz?: string };
  profile?: Record<string, Json>;
  spine?: SpineEntry[];
  records?: RecordLine[];
  today?: Record<string, Json>;
  pending?: PendingLine[];
  commitments?: CommitmentLine[];
  draft?: DraftLine | null;
  history?: HistoryTurn[];
  tier?: 'none' | 'watch' | 'amber' | 'red';
  tripwires?: TripwireHit[];
  reference_candidates?: ReferenceCandidate[];
  gates?: string[]; // "yazma kapıları" lines (§4.2/4)
  image?: boolean;
}

/** T1 fixed client protocols (§3.2): exact-match literals that never reach Stage A. */
export interface ClientProtocol {
  protocol: 'undo_button' | 'plan_approve';
  draft_ref?: string;
}

// ── Expectations ────────────────────────────────────────────────────────────────────────────────

export type Quantifier = 'any' | 'all' | 'none';

/** One path + exactly one operator. Paths: `decision.writes[op=water_log].unit`, `[*]`, `[0]`,
 *  `[name~tuz]` (contains, Turkish lower-case), `[ref!=m3]`, and `..key` (deep search). */
export interface PathExpectation {
  path: string;
  eq?: Json;
  ne?: Json;
  in?: Json[];
  not_in?: Json[];
  between?: [number, number];
  gte?: number;
  lte?: number;
  gt?: number;
  lt?: number;
  exists?: boolean;
  absent?: boolean;
  count?: number;
  count_gte?: number;
  count_lte?: number;
  empty?: boolean;
  contains?: string;
  not_contains?: string;
  contains_any?: string[];
  not_contains_any?: string[];
  /** Safety-level truthiness: true/"possible"/"clear"/{category:"purging"} are positive; false/null/"none" negative. */
  flag?: boolean;
  /** The value must be a substring of the normalized USER message (evidence_quote rule, §7.2). */
  verbatim_in_message?: boolean;
  /** Multiset equality with another path's values ("işlenen satır == argüman", §2 rule 1). */
  eq_path?: string;
  quantifier?: Quantifier;
  why?: string;
}
export interface AnyOfExpectation { any_of: Expectation[]; why?: string }
export interface AllOfExpectation { all_of: Expectation[]; why?: string }
export type Expectation = PathExpectation | AnyOfExpectation | AllOfExpectation;

export const VALUE_OPERATORS = [
  'eq', 'ne', 'in', 'not_in', 'between', 'gte', 'lte', 'gt', 'lt', 'contains', 'not_contains',
  'contains_any', 'not_contains_any', 'flag', 'verbatim_in_message', 'eq_path',
] as const;
export const SET_OPERATORS = ['exists', 'absent', 'count', 'count_gte', 'count_lte', 'empty'] as const;
export type ValueOperator = typeof VALUE_OPERATORS[number];
export type SetOperator = typeof SET_OPERATORS[number];

/** Stage B reply rubric (§9.4 C, machine part). Judge-only items need a JudgePort. */
export type RubricId =
  | 'claims_subset_of_receipts' // lint pre-filter + luna judge
  | 'max_one_question'
  | 'diacritics_ok'
  | 'no_english_enum_leak'
  | 'emergency_line_present' //   112 line on emergency
  | 'no_emergency_line' //        benign idiom must not get the 112 reply
  | 'referral_line_present' //    uzman / psikolog / diyetisyen line on ED/crisis
  | 'no_canned_referral' //       the old ASCII siz-voice referral must not come back
  | 'answers_user_question'; //   judge only
export const RUBRIC_IDS: readonly RubricId[] = [
  'claims_subset_of_receipts', 'max_one_question', 'diacritics_ok', 'no_english_enum_leak',
  'emergency_line_present', 'no_emergency_line', 'referral_line_present', 'no_canned_referral',
  'answers_user_question',
];
export const JUDGE_ONLY_RUBRIC: readonly RubricId[] = ['answers_user_question'];

export interface EvalFixture {
  id: string;
  /** Where the case comes from: 'round3:final2#3', 'devir:§8', 'probe:cap-schema', 'spec:§9.4', ... */
  source: string;
  package: PackageId;
  /** One Turkish line: what this fixture guards. */
  title: string;
  pipeline?: FixturePipeline;
  persona?: string;
  turn_input: FixtureTurnInput;
  message: string;
  client?: ClientProtocol;
  expect: Expectation[];
  reply_rubric?: RubricId[];
  tags?: string[];
}

// ── Results ─────────────────────────────────────────────────────────────────────────────────────

export type StageStatus = 'ok' | 'error' | 'not_run';
export type StageOutputs = Partial<Record<StageRoot, unknown>>;

export interface TurnResult {
  outputs: StageOutputs;
  stages: Partial<Record<StageRoot, StageStatus>>;
  stage_errors: Partial<Record<StageRoot, string>>;
}

export type OutcomeStatus = 'pass' | 'fail' | 'skipped';
export interface ExpectationOutcome { index: number; label: string; status: OutcomeStatus; detail: string }
export interface RubricOutcome { rubric: RubricId; status: OutcomeStatus; detail: string; by: 'machine' | 'judge' | 'none' }

/** pass/fail = the model's behaviour; skipped = nothing evaluable ran; error = harness/transport. */
export type RunStatus = 'pass' | 'fail' | 'skipped' | 'error';
export type CacheClass = 'hit' | 'miss' | 'live' | 'local' | 'none';

export interface Usage { input_tokens?: number; output_tokens?: number; cached_tokens?: number; reasoning_tokens?: number }

export interface FixtureRunResult {
  fixture_id: string;
  package: PackageId;
  source: string;
  rep: number;
  status: RunStatus;
  outcomes: ExpectationOutcome[];
  rubric: RubricOutcome[];
  cache: CacheClass;
  request_key?: string;
  latency_ms?: number;
  usage?: Usage;
  schema_errors?: string[];
  parse_error?: string;
  error?: string;
  skip_reason?: string;
  decision?: unknown;
}

export type GateStatus = 'pass' | 'fail' | 'no_data' | 'incomplete';
export interface GateResult {
  package: PackageId;
  status: GateStatus;
  label_tr: string;
  runs: number;
  passed: number;
  rate: number | null;
  detail: string;
}

export interface EvalReport {
  started_at: string;
  finished_at: string;
  mode: string;
  model: string;
  effort: string;
  reps: number;
  fixture_count: number;
  results: FixtureRunResult[];
  gates: GateResult[];
  totals: Record<RunStatus, number> & { cache_miss: number };
  latency: { p50_ms: number | null; p90_ms: number | null; samples: number };
  cost_usd_estimate: number | null;
}
