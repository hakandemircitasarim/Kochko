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
  | 't2' //         T2 safety floor (shared/safety-tripwires.ts scan): explicit → canned, no Stage A
  | 'decision' //   Stage A strict-schema output (kochko_understand_vN, the registry's schema)
  | 'validation' // the registry's validateDecision() result, verbatim (verdicts[], safety, repair…)
  | 'commit' //     simulated commit: commit.<op>[] = verdict.row (args ⊕ derive) + declared invariants
  | 'receipts' //   the registry's toActionReceipt() over the simulated commit (writer assumed ok)
  | 'reply' //      Stage B kochko_reply_vN (or the T2 canned text when Stage A never ran)
  | 'envelope' //   renderEnvelope → TurnEnvelope the client reads
  | 'facts' //      Stage B facts block ("BU TURDA OLANLAR", budget, agenda)
  | 'report' //     ai-report output (pipeline 'report')
  | 'plan' //       plan pipeline output (pipeline 'plan')
  | 'meta'; //      latency, usage, cache class
export const STAGE_ROOTS: readonly StageRoot[] = [
  't2', 'decision', 'validation', 'commit', 'receipts', 'reply', 'envelope', 'facts', 'report', 'plan', 'meta',
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

/** Record kinds a fixture may render; each maps to a registry RefTarget (bind.ts RECORD_TARGET). */
export const RECORD_KINDS = ['meal', 'water', 'workout', 'sleep', 'weight', 'supplement', 'mood', 'steps', 'venue', 'profile', 'life_event', 'lab', 'food_pref'] as const;
export type RecordKind = typeof RECORD_KINDS[number];

export interface RecordLine {
  ref: string;
  kind: RecordKind;
  day: string; // YYYY-MM-DD
  line: string; // rendered one-liner, exactly what Stage A would read
  last_turn?: boolean;
  /** Validator facts (RenderedRef), not rendered: the loader knows them, the model does not. */
  undone?: boolean;
  later_write_on_same_field?: boolean;
  suspicion_declined?: boolean;
}

export interface PendingLine { ref: string; op: string; line: string; expires_at?: string; replies_since?: number }
export interface CommitmentLine { ref: string; line: string }
export interface DraftLine { ref: string; plan_type: 'diet' | 'workout'; version: number; line: string }
export interface HistoryTurn { role: 'user' | 'assistant'; content: string; receipts?: string[] }
/** A REFERANS ADAYLARI row: `line` is what the model reads; the numbers are the validator's
 *  ReferenceRow (meal_log derive() uses them when the model picks this key). */
export interface ReferenceCandidate {
  key: string;
  line: string;
  name_tr: string;
  kcal_per_100g: number;
  protein_per_100g?: number | null;
  carbs_per_100g?: number | null;
  fat_per_100g?: number | null;
}

/**
 * NOTE — no `tripwires` field: T2 is not declared by fixtures any more. The runner computes it
 * from the message with shared/safety-tripwires.ts scanTripwires(), exactly as production does,
 * and renders the facts with renderTripwireFacts(). (fixtures.ts lint rejects the old field.)
 */
export interface FixtureTurnInput {
  /** `weekday_tr` is informational: the renderer derives the weekday from `local_date` (as for a live turn). */
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
  reference_candidates?: ReferenceCandidate[];
  gates?: string[]; // extra "yazma kapıları" lines (§4.2/4); the ED-tier gate is derived from `tier` by the renderer
  image?: boolean;
  /** Validator-only fact (ValidationContext.last_weight): the latest weigh-in of the last 14 days. */
  last_weight?: { kg: number; day: string } | null;
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
  /** Whole-word match (Turkish lower-case tokens): "kek" hits "havuçlu kek", not "kekikli tavuk".
   *  A multi-word needle matches a run of consecutive tokens. */
  contains_word_any?: string[];
  not_contains_word_any?: string[];
  /**
   * Token-prefix match (Turkish lower-case tokens): a token that STARTS WITH a prefix hits, so every
   * suffixed form is caught ("kek" → keke, kekleri, havuçlu kek; "pasta" → pastası), unless the
   * token starts with one of `except` ("kekik" → kekikli tavuk is not cake). Each exception must
   * itself extend one of the prefixes (lint).
   */
  contains_prefix_any?: PrefixMatch;
  not_contains_prefix_any?: PrefixMatch;
  /**
   * A registry safety field read as a signal through ITS declaration (envelope.ts
   * ENVELOPE_HEAD.safety; the path's last key names the field): a boolean (acute_medical,
   * self_harm) is itself; ed_signal is null (negative) or {category, severity, evidence_quote} —
   * positive unless category is `illness_vomiting` ("YB değil"); tripwire_readings is a list of
   * {hit_id, reading, reason} — [] is negative, positive when ANY reading is `positive`. Any other
   * shape is NOT guessed: the check fails (closed). On a path that is not a safety field it is a
   * lint error.
   */
  flag?: boolean;
  /** The value must be a substring of the normalized USER message (evidence_quote rule, §7.2). */
  verbatim_in_message?: boolean;
  /** Multiset equality with another path's values ("işlenen satır == argüman", §2 rule 1). */
  eq_path?: string;
  quantifier?: Quantifier;
  why?: string;
}
export interface PrefixMatch { prefixes: string[]; except?: string[] }
export interface AnyOfExpectation { any_of: Expectation[]; why?: string }
export interface AllOfExpectation { all_of: Expectation[]; why?: string }
export type Expectation = PathExpectation | AnyOfExpectation | AllOfExpectation;

export const VALUE_OPERATORS = [
  'eq', 'ne', 'in', 'not_in', 'between', 'gte', 'lte', 'gt', 'lt', 'contains', 'not_contains',
  'contains_any', 'not_contains_any', 'contains_word_any', 'not_contains_word_any', 'contains_prefix_any', 'not_contains_prefix_any',
  'flag', 'verbatim_in_message', 'eq_path',
] as const;
/** Operators that assert ABSENCE; vacuously true on an empty set, so a path that cannot resolve
 *  (a renamed field) must fail them instead of passing silently (expect.ts). */
export const NEGATIVE_OPERATORS: readonly string[] = ['ne', 'not_in', 'not_contains', 'not_contains_any', 'not_contains_word_any', 'not_contains_prefix_any'];
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
  /**
   * Fields a stage that DID run does not produce yet, with the reason (the simulated receipts have
   * no allergen_exposure until the commit layer's consumption check exists). An expectation that
   * reads one is skipped with that reason — never failed, never passed.
   */
  unbound?: Partial<Record<StageRoot, Record<string, string>>>;
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
  /** validateDecision said one repair call would be made (§3.2 T5) — E gate tracks the rate. */
  repair_needed?: boolean;
  /** T2 answered with the canned reply; Stage A was never called (as in production). */
  canned?: boolean;
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
  /** Checks evaluated vs skipped (a stage not built yet) across the judged runs. A gate that
   *  passed with skipped checks is PARTIAL: green on what exists, not full coverage. */
  checks_evaluated?: number;
  checks_skipped?: number;
  partial?: boolean;
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
