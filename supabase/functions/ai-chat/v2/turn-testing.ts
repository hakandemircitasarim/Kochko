/**
 * ai-chat/v2/turn-testing.ts — test doubles for the v2 TURN (commit.ts, adapter.ts, handler.ts,
 * route.ts): a fake writer-RPC backend, a fake adapter DB, a fake Stage A, and a full fake V2Deps
 * that records every side effect. Stage B is NOT faked: the deps carry the PRODUCTION ports
 * (ports.ts stageBPorts — coach.ts runCoach, postcheck.ts with the luna judge, envelope.ts) over a
 * fake Responses transport, so a handler test runs the real T6/T7/T8 end to end. No network, no
 * database. Imported by *.test.ts only.
 */
import type { AdapterDb, AdapterHelpers, DbRows } from './adapter.ts';
import type { AdapterOutcome, AdapterPort, AdapterRequest, CommitPorts, ResolvedTarget, RpcResult, TargetSpec } from './commit.ts';
import type { CoachInput, CoachReply, PostcheckPort } from './contracts.ts';
import type { ClaimResult, LastTurnLedgerRow, PersistTurnInput, V2Deps } from './handler.ts';
import { loadTurnInput, type TurnInput } from './input.ts';
import { stageBPorts } from './ports.ts';
import { fakeResponses, fakeTurnInputDb, NOW, responsesBody, seedTables, USER } from './testing.ts';
import type { UnderstandOutcome, UnderstandRequest } from './understand.ts';

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export async function seededTurnInput(mutate?: (t: ReturnType<typeof seedTables>) => void): Promise<TurnInput> {
  const t = seedTables();
  t.weekly_plans = t.weekly_plans.filter((p) => p.status !== 'draft');
  mutate?.(t);
  return await loadTurnInput(fakeTurnInputDb(t), { userId: USER, now: NOW });
}

// ─── writer RPCs ─────────────────────────────────────────────────────────────────────────────────

export interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

/** Default RPC answers shaped like migrations 108/109/113 (ok receipts). */
export function defaultRpcAnswer(name: string, args: Record<string, unknown>): unknown {
  const p = isRec(args.p_payload) ? args.p_payload : {};
  switch (name) {
    case 'w_meal_apply': {
      const items = Array.isArray(p.items) ? p.items.filter(isRec) : [];
      return {
        ok: true, op: 'meal_log', turn_id: args.p_turn_id, write_id: 'wid-meal', group_id: 'g1', ref: 'm40', day: p.day, replaced: null,
        pending_id: p.pending_id ?? null, row_id: 'row-meal', meal_type: p.meal_type, confidence: 'medium', total_kcal: 0,
        items: items.map((it, i) => ({ id: `it${i}`, name: it.name, allergen_tags: it.allergens ?? [], may_contain: it.may_contain ?? [], kcal: it.kcal })),
      };
    }
    case 'w_water_apply':
      return { ok: true, op: 'water_log', turn_id: args.p_turn_id, write_id: 'wid-water', group_id: 'g2', ref: 'd40', day: p.day, mode: p.mode, liters: p.liters, previous_total: 1.6, total: 1.8, replaced: null, pending_id: p.pending_id ?? null };
    case 'w_metric_apply': {
      const op = p.metric === 'weight' ? 'body_weight' : p.metric === 'sleep' ? 'sleep_log' : p.metric === 'mood' ? 'mood_log' : 'step_log';
      return { ok: true, op, metric: p.metric, turn_id: args.p_turn_id, write_id: 'wid-metric', group_id: 'g3', ref: p.metric === 'weight' ? 'w40' : 'd41', day: p.day, values: p.values, previous: {}, normalized: [], side_effects: [], replaced: null, pending_id: p.pending_id ?? null };
    }
    case 'w_record_delete':
      return { ok: true, op: 'record_delete', turn_id: args.p_turn_id, group_id: 'g4', scope: 'record', target: {}, reversed: [{ write_id: 'r1' }], needs_review: false };
    case 'w_record_restore':
      return { ok: true, op: 'record_restore', turn_id: args.p_turn_id, group_id: 'g5', scope: 'record', target: {}, reversed: [{ write_id: 'r2' }], needs_review: false };
    case 'v2_hold_open':
      return { ok: true, op: 'hold_open', pending_id: 'pw-new', ref: 'p9', expires_at: '2026-10-09T11:30:00Z', superseded_id: null, hold_class: isRec(args.p_opts) ? args.p_opts.hold_class : 'ask' };
    case 'v2_hold_resolve':
      return { ok: true, op: 'hold_resolve', pending_id: args.p_pending_id, status: args.p_status };
    case 'v2_ledger_append':
      return { ok: true, op: 'ledger_append', turn_id: args.p_turn_id, entries: (Array.isArray(args.p_entries) ? args.p_entries : []).map((_e, i) => ({ index: i, write_id: `led-${i}`, group_id: 'gl', ref: i === 0 ? 'x1' : null })) };
    default:
      return { ok: true, op: name };
  }
}

export interface FakeAdapter extends AdapterPort {
  calls: AdapterRequest[];
  eraseHolds: string[];
  eraseConfirms: number;
}

export function fakeAdapter(answer?: (req: AdapterRequest) => AdapterOutcome): FakeAdapter {
  const a: FakeAdapter = {
    calls: [],
    eraseHolds: [],
    eraseConfirms: 0,
    apply(req) {
      a.calls.push(req);
      return Promise.resolve(answer?.(req) ?? { ok: true, rows_affected: 1, failure_class: null, ref: `${req.op === 'supplement_log' ? 's' : 'x'}40`, write_id: 'wid-adapter' });
    },
    createEraseHold(_u, scope) {
      a.eraseHolds.push(scope);
      return Promise.resolve({ ok: true, id: 'pw-erase' });
    },
    confirmEraseHold() {
      a.eraseConfirms++;
      return Promise.resolve({ ok: true, scope: 'memory', line: 'Onayın üzerine hakkında tuttuğum koç hafızasını sıfırladım.', failureClass: null });
    },
  };
  return a;
}

export interface FakeCommitPorts extends CommitPorts {
  rpcCalls: RpcCall[];
  resolved: TargetSpec[];
  writes: number;
  adapter: FakeAdapter;
}

export function fakeCommitPorts(opts: {
  rpc?: (name: string, args: Record<string, unknown>) => unknown;
  resolve?: (t: TargetSpec) => ResolvedTarget;
  adapter?: FakeAdapter;
} = {}): FakeCommitPorts {
  const ports: FakeCommitPorts = {
    rpcCalls: [],
    resolved: [],
    writes: 0,
    adapter: opts.adapter ?? fakeAdapter(),
    rpc(name, args): Promise<RpcResult> {
      ports.rpcCalls.push({ name, args });
      const custom = opts.rpc?.(name, args);
      return Promise.resolve({ data: custom === undefined ? defaultRpcAnswer(name, args) : custom, error: null });
    },
    resolveTarget(_u, _d, t) {
      ports.resolved.push(t);
      if (opts.resolve) return Promise.resolve(opts.resolve(t));
      if (t.kind === 'row') return Promise.resolve({ ok: true, ref: 'm7', write_id: null });
      if (t.kind === 'metric') return Promise.resolve({ ok: true, ref: 'd7', write_id: 'wid-old' });
      return Promise.resolve({ ok: false, failure_class: t.reason });
    },
    onWrite() { ports.writes++; },
    log() {},
  };
  return ports;
}

// ─── adapter DB ──────────────────────────────────────────────────────────────────────────────────

export interface DbCall {
  kind: 'insert' | 'update' | 'upsert' | 'selectOne' | 'rpc';
  table: string;
  payload?: unknown;
  match?: Record<string, unknown>;
  args?: Record<string, unknown>;
}

export interface FakeAdapterDb extends AdapterDb {
  calls: DbCall[];
  rows: Record<string, Record<string, unknown>[]>;
}

/** In-memory tables; inserts get ids; `fail[table]` makes that table's writes error out, `fail['select:<table>']` its reads. */
export function fakeAdapterDb(seed: Record<string, Record<string, unknown>[]> = {}, opts: {
  fail?: Record<string, string>;
  rpc?: (name: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null } | undefined;
} = {}): FakeAdapterDb {
  let n = 0;
  const rows: Record<string, Record<string, unknown>[]> = structuredClone(seed);
  const matches = (r: Record<string, unknown>, m: Record<string, unknown>) => Object.entries(m).every(([k, v]) => (v === null ? r[k] == null : r[k] === v));
  const err = (table: string) => (opts.fail?.[table] ? { message: opts.fail[table], code: '23514' } : null);
  const db: FakeAdapterDb = {
    calls: [],
    rows,
    insert(table, input, _returning): Promise<DbRows> {
      db.calls.push({ kind: 'insert', table, payload: structuredClone(input) });
      if (err(table)) return Promise.resolve({ data: null, error: err(table) });
      const list = (Array.isArray(input) ? input : [input]).map((r) => ({ id: `${table}-${++n}`, ...r }));
      (rows[table] ??= []).push(...list);
      return Promise.resolve({ data: list.map((r) => ({ id: r.id })), error: null });
    },
    update(table, patch, match, _returning): Promise<DbRows> {
      db.calls.push({ kind: 'update', table, payload: structuredClone(patch), match });
      if (err(table)) return Promise.resolve({ data: null, error: err(table) });
      const hit = (rows[table] ?? []).filter((r) => matches(r, match));
      for (const r of hit) Object.assign(r, patch);
      return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
    },
    upsert(table, row, onConflict) {
      db.calls.push({ kind: 'upsert', table, payload: structuredClone(row) });
      if (err(table)) return Promise.resolve({ error: err(table) });
      const keys = onConflict.split(',');
      const list = (rows[table] ??= []);
      const i = list.findIndex((r) => keys.every((k) => r[k] === row[k]));
      if (i >= 0) list[i] = { ...list[i], ...row };
      else list.push({ id: `${table}-${++n}`, ...row });
      return Promise.resolve({ error: null });
    },
    selectOne(table, _columns, match) {
      db.calls.push({ kind: 'selectOne', table, match });
      if (err(`select:${table}`)) return Promise.resolve({ data: null, error: err(`select:${table}`) });
      const r =(rows[table] ?? []).find((x) => matches(x, match)) ?? null;
      return Promise.resolve({ data: r ? { ...r } : null, error: null });
    },
    rpc(name, args) {
      db.calls.push({ kind: 'rpc', table: name, args: structuredClone(args) });
      const custom = opts.rpc?.(name, args);
      if (custom) return Promise.resolve(custom);
      return Promise.resolve({ data: defaultRpcAnswer(name, args), error: null });
    },
  };
  return db;
}

export interface FakeHelpers extends AdapterHelpers {
  synced: Array<{ userId: string; c: Parameters<AdapterHelpers['syncConstraint']>[1] }>;
  notes: string[];
  patterns: Record<string, unknown>[];
  layer2: Record<string, unknown>[];
}

/**
 * Shared-writer doubles. With `db`, syncConstraint behaves like shared/constraints.ts on that fake
 * DB: an upsert on (user_id, kind, lowercased subject) that leaves the row active, so the adapter
 * can read the spine row back (its ledger entry names the row).
 */
export function fakeHelpers(opts: { syncOk?: boolean; db?: FakeAdapterDb } = {}): FakeHelpers {
  const h: FakeHelpers = {
    synced: [], notes: [], patterns: [], layer2: [],
    syncConstraint(userId, c) {
      h.synced.push({ userId, c });
      const ok = opts.syncOk ?? true;
      if (ok && opts.db) {
        const subject = c.subject.trim().toLocaleLowerCase('tr').slice(0, 80);
        const list = (opts.db.rows.user_constraints ??= []);
        const row = { user_id: userId, kind: c.kind, subject, severity: c.severity ?? null, body_parts: c.body_parts ?? [], active: true };
        const i = list.findIndex((r) => r.user_id === userId && r.kind === c.kind && r.subject === subject);
        if (i >= 0) list[i] = { ...list[i], ...row };
        else list.push({ id: `uc-${list.length + 1}-${subject}`, ...row });
      }
      return Promise.resolve(ok);
    },
    appendCoachingNote(_u, _s, text) { h.notes.push(text); return Promise.resolve({ ok: true }); },
    appendBehavioralPatterns(_u, p) { h.patterns.push(...p); return Promise.resolve(); },
    updateLayer2(_u, patch) { h.layer2.push(patch); return Promise.resolve(); },
    createEraseHold() { return Promise.resolve({ ok: true, id: 'pw-erase' }); },
    confirmEraseHold() { return Promise.resolve({ ok: true, scope: 'memory', line: 'sıfırladım', failureClass: null }); },
  };
  return h;
}

// ─── Stage A / Stage B ───────────────────────────────────────────────────────────────────────────

export function parsedOutcome(decision: unknown, req: UnderstandRequest, over: Partial<UnderstandOutcome> = {}, latencyMs = 1500): UnderstandOutcome {
  return {
    status: 'parsed', decision, refusal: null, issues: [], candidate: null, reason: null, error: null,
    meta: {
      model: req.model, providerModel: 'gpt-5.6-terra-x', api: 'responses', format: 'json_schema', effort: req.effort,
      latencyMs, attempts: 1, retries: [], responseId: 'r1', finishReason: 'stop',
      usage: { inputTokens: 9500, outputTokens: 200, totalTokens: 9700, reasoningTokens: 80, cachedTokens: 8800 },
    },
    ...over,
  };
}

export function failedOutcome(req: UnderstandRequest, cls: 'timeout' | 'http' = 'http'): UnderstandOutcome {
  return { ...parsedOutcome(null, req), status: 'error', decision: null, error: { class: cls, status: cls === 'http' ? 500 : null, message: 'boom' } };
}

/** A strict-schema-valid 'kochko_reply_vN' answer (the fake transport sends it as the model's output). */
export function coachReply(text: string, over: Partial<CoachReply> = {}): CoachReply {
  return {
    suggested_foods: [], suggested_exercises: [], reply: text, why: null, memory: [],
    ui: { navigate_to: null, task_completion_summary: null }, referral_included: false, ...over,
  };
}

/** The default Stage B answer of fakeDeps. */
export const DEFAULT_COACH_TEXT = 'Afiyet olsun! Akşam için protein ağırlıklı bir şey düşünelim mi?';

/** A provider error the coach reports as status 'error' at once (4xx: no transient retry, no backoff). */
export function providerError(): Response {
  return new Response('{"error":{"message":"bad request"}}', { status: 400 });
}

// ─── full V2Deps ─────────────────────────────────────────────────────────────────────────────────

export interface Recorder {
  persisted: PersistTurnInput[];
  turnLogs: Record<string, unknown>[];
  journal: Array<{ kind: 'claim' | 'commit' | 'fail' | 'side_effects'; key: string; envelope?: unknown }>;
  reserved: string[];
  released: string[];
  understandReqs: UnderstandRequest[];
  /** Every CoachInput the coach PORT was called with (the first call and the ONE regen). */
  coachInputs: CoachInput[];
  /** The HTTP bodies the real coach sent / the luna judge received over the fake transport. */
  coachCalls: Record<string, unknown>[];
  judgeCalls: Record<string, unknown>[];
  edSignals: string[];
  jobs: Array<() => Promise<unknown>>;
  links: string[];
  logs: string[];
  undoLookups: string[];
}

export interface FakeDepsOptions {
  turnInput?: TurnInput;
  stageA?: (req: UnderstandRequest, n: number) => UnderstandOutcome;
  /**
   * Stage B's answers by call (1-based; the first call and the ONE regen), sent by the fake transport
   * as the model's strict output — a Response goes as is (providerError(), refusalBody()). Default:
   * DEFAULT_COACH_TEXT.
   */
  coach?: (n: number, input: CoachInput) => CoachReply | Response;
  /** The luna judge's answers by call (default: clean). */
  judge?: (n: number) => { violation: boolean; items: unknown[] } | Response;
  /** Replace the T7 port (tests proving the code-owned lines survive ANY port). */
  postcheck?: PostcheckPort;
  commit?: FakeCommitPorts;
  userId?: string;
  claim?: ClaimResult;
  reserveAllowed?: boolean;
  capAllowed?: boolean;
  /** What UndoPort.lastTurnLedger answers ('error' = the read fails). Default: a turn the ledger never saw. */
  lastTurn?: { turnId: string | null; rows: LastTurnLedgerRow[] } | 'error';
  persistThrows?: string;
  sideEffectsClaim?: boolean;
}

export function fakeDeps(o: FakeDepsOptions = {}): { deps: V2Deps; rec: Recorder; commit: FakeCommitPorts } {
  const rec: Recorder = {
    persisted: [], turnLogs: [], journal: [], reserved: [], released: [], understandReqs: [], coachInputs: [], coachCalls: [], judgeCalls: [],
    edSignals: [], jobs: [], links: [], logs: [], undoLookups: [],
  };
  const commit = o.commit ?? fakeCommitPorts();
  // ONE fake Responses transport for both models, routed by the strict schema name in the body.
  const stageB = fakeResponses((call) => {
    const format = (call.body.text as Record<string, unknown> | undefined)?.format as Record<string, unknown> | undefined;
    if (format?.name === 'kochko_judge_v1') {
      rec.judgeCalls.push(call.body);
      const a = o.judge ? o.judge(rec.judgeCalls.length) : { violation: false, items: [] };
      return a instanceof Response ? a : responsesBody(a);
    }
    rec.coachCalls.push(call.body);
    const a = o.coach ? o.coach(rec.coachCalls.length, rec.coachInputs[rec.coachInputs.length - 1]) : coachReply(DEFAULT_COACH_TEXT);
    return a instanceof Response ? a : responsesBody(a);
  });
  const ports = stageBPorts({ transport: stageB.transport });
  let ids = 0;
  const deps: V2Deps = {
    now: () => NOW,
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    log: (line) => { rec.logs.push(line); },
    getUserId: () => Promise.resolve(o.userId ?? USER),
    checkPayloadSize: () => ({ valid: true }),
    validateChatRequest: (b) => (isRec(b) && (b.message || b.image_base64 || b.audio_base64) ? { valid: true } : { valid: false, error: 'x' }),
    respond: (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } }),
    journal: {
      claim: (_u, key) => { rec.journal.push({ kind: 'claim', key }); return Promise.resolve(o.claim ?? { mode: 'owner' }); },
      commit: (_u, key, envelope) => { rec.journal.push({ kind: 'commit', key, envelope }); return Promise.resolve(); },
      fail: (_u, key) => { rec.journal.push({ kind: 'fail', key }); return Promise.resolve(); },
      claimSideEffects: (_u, key) => { rec.journal.push({ kind: 'side_effects', key }); return Promise.resolve(o.sideEffectsClaim ?? true); },
    },
    quota: {
      reserve: (_u, msg) => {
        rec.reserved.push(msg);
        return Promise.resolve(o.reserveAllowed === false
          ? { allowed: false, remaining: 0, message: 'Bugünlük kayıt limitine ulaştın.', reservedMessageId: null }
          : { allowed: true, remaining: -1, reservedMessageId: 'res-1' });
      },
      release: (id) => { rec.released.push(id); return Promise.resolve(); },
      conversationCap: () => Promise.resolve(o.capAllowed === false
        ? { allowed: false, remaining: 0, message: 'Bugünlük 50 ücretsiz mesaj hakkını kullandın.' }
        : { allowed: true, remaining: 41 }),
    },
    loadTurnInput: () => (o.turnInput ? Promise.resolve(o.turnInput) : seededTurnInput()),
    understand: (req) => {
      rec.understandReqs.push(req);
      return Promise.resolve(o.stageA ? o.stageA(req, rec.understandReqs.length) : failedOutcome(req));
    },
    commitPorts: commit,
    adapter: commit.adapter,
    recordEdSignal: (_u, s) => { rec.edSignals.push(s); return Promise.resolve('watch'); },
    coach: (input, call) => { rec.coachInputs.push(input); return ports.coach(input, call); },
    postcheck: o.postcheck ?? ports.postcheck,
    envelope: ports.envelope,
    undo: {
      lastTurnLedger: (u) => {
        rec.undoLookups.push(u);
        if (o.lastTurn === 'error') return Promise.reject(new Error('read failed'));
        return Promise.resolve(o.lastTurn ?? { turnId: null, rows: [] });
      },
    },
    store: {
      persist: (p) => {
        if (o.persistThrows) return Promise.reject(new Error(o.persistThrows));
        rec.persisted.push(p);
        return Promise.resolve('asst-1');
      },
      linkTurnMessage: (_u, turnId, id) => { rec.links.push(`${turnId}:${id}`); return Promise.resolve(); },
    },
    turnLog: (rows) => { rec.turnLogs.push(...rows); return Promise.resolve(); },
    schedule: (job) => { rec.jobs.push(job); },
    rolloutStamp: () => 'v2_turn=on',
  };
  return { deps, rec, commit };
}

/** One ledger row of the last turn (live primary write unless overridden). */
export function ledgerRow(op: string, id: string, over: Partial<LastTurnLedgerRow> = {}): LastTurnLedgerRow {
  return { id, ref: null, op, is_primary: true, undone_at: null, reverses: null, ...over };
}

/** A POST like the client's sendMessageToSession. */
export function chatRequest(body: Record<string, unknown>, headers: Record<string, string> = {}): Request {
  return new Request('https://edge.test/ai-chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${fakeJwt(USER)}`, ...headers },
    body: JSON.stringify(body),
  });
}

/** An unsigned JWT with the given sub (routing reads it; verification is getUserId's job). */
export function fakeJwt(sub: string): string {
  const enc = (o: unknown) => btoa(JSON.stringify(o)).split('=').join('').split('+').join('-').split('/').join('_');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub, role: 'authenticated' })}.sig`;
}
