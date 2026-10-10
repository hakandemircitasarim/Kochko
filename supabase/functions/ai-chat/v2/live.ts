/**
 * ai-chat/v2/live.ts — the production wiring of the v2 turn (handler.ts V2Deps).
 *
 * Everything here is an adapter onto code that already exists: the shared modules (auth, request
 * validation, rate limit, safety state, spine, coaching notes, erase hold, rollout) are imported;
 * the helpers that live inside ai-chat/index.ts (request journal, storeMessages, respond, the TDEE /
 * onboarding hooks) are passed in by index.ts — one implementation each, never a fork.
 *
 * T7/T8: the coach builder's postcheck/envelope modules plug in here (postcheck/envelope below);
 * until they are merged the handler uses ports.ts defaultPostcheck/defaultEnvelope.
 */
import { appendBehavioralPatterns, updateLayer2 } from '../../shared/memory.ts';
import { appendCoachingNote } from '../../shared/coaching-notes.ts';
import { syncConstraint } from '../../shared/constraints.ts';
import { confirmEraseHold, createEraseHold } from '../../shared/erase-hold.ts';
import { checkRateLimit, reserveRateLimitSlot } from '../../shared/rate-limit.ts';
import { checkPayloadSize, validateChatRequest } from '../../shared/request-validator.ts';
import { ACTIVE_ROLLOUT_STEPS, rolloutStamp } from '../../shared/rollout.ts';
import { recordEDSignal } from '../../shared/safety-state.ts';
import { getUserId, supabaseAdmin } from '../../shared/supabase-admin.ts';
import type { CodeNote, QuotaClass } from '../../shared/v2-db-types.ts';
import { createAdapter, type AdapterDb, type DbError } from './adapter.ts';
import { runCoach } from './coach.ts';
import type { CommitPorts, ResolvedTarget, TargetSpec } from './commit.ts';
import type { AppliedWrite, ClaimResult, V2Deps } from './handler.ts';
import { loadTurnInput, supabaseTurnInputDb, type PgClientLike, type TurnInput } from './input.ts';
import { scheduleBackground } from './shadow.ts';
import { understand } from './understand.ts';

/** The v2 columns storeMessages writes when given them (index.ts; absent = v1 behaviour, unchanged). */
export interface StoreV2Extras {
  turnId: string;
  pipeline: 'v2';
  quotaClass: QuotaClass;
  codeNotes: CodeNote[] | null;
  actionsExecuted: Record<string, unknown>[] | null;
}

/** What ai-chat/index.ts hands over: its own helpers, by reference. */
export interface IndexHelpers {
  respond(data: unknown, status?: number): Response;
  claimOrAwaitRequest(userId: string, key: string): Promise<ClaimResult>;
  commitRequestEnvelope(userId: string, key: string, envelope: unknown): Promise<void>;
  failRequest(userId: string, key: string): Promise<void>;
  storeMessages(
    userId: string, userMsg: string, assistantMsg: string, taskMode?: string, modelUsed?: string, tokenCount?: number,
    executedActions?: Record<string, unknown>[], externalSessionId?: string, reservedUserMessageId?: string | null, v2?: StoreV2Extras,
  ): Promise<string | null>;
  afterCommit?(p: { userId: string; turnInput: TurnInput; applied: AppliedWrite[] }): Promise<void>;
  mark?(stage: string): void;
}

// ─── supabase-js, structurally (keeps the generated client types out of the adapter) ──────────

interface Q extends PromiseLike<{ data: unknown; error: DbError | null }> {
  select(columns: string): Q;
  insert(rows: unknown): Q;
  update(patch: unknown): Q;
  upsert(row: unknown, opts: { onConflict: string }): Q;
  delete(): Q;
  eq(column: string, value: unknown): Q;
  is(column: string, value: null): Q;
  contains(column: string, value: unknown): Q;
  order(column: string, opts: { ascending: boolean }): Q;
  limit(n: number): Q;
  maybeSingle(): Q;
}

interface Client {
  from(table: string): unknown;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError | null }>;
}

const db = supabaseAdmin as unknown as Client;
const from = (table: string): Q => db.from(table) as Q;
const rowsOf = (data: unknown): Record<string, unknown>[] | null =>
  Array.isArray(data) ? data as Record<string, unknown>[] : data ? [data as Record<string, unknown>] : null;

function matchAll(q: Q, match: Record<string, unknown>): Q {
  let out = q;
  for (const [k, v] of Object.entries(match)) out = v === null ? out.is(k, null) : out.eq(k, v);
  return out;
}

export const supabaseAdapterDb: AdapterDb = {
  async insert(table, rows, returning) {
    let q = from(table).insert(rows);
    if (returning) q = q.select(returning);
    const { data, error } = await q;
    return { data: rowsOf(data), error };
  },
  async update(table, patch, match, returning) {
    let q = matchAll(from(table).update(patch), match);
    if (returning) q = q.select(returning);
    const { data, error } = await q;
    return { data: rowsOf(data), error };
  },
  async upsert(table, row, onConflict) {
    const { error } = await from(table).upsert(row, { onConflict });
    return { error };
  },
  async selectOne(table, columns, match) {
    const { data, error } = await matchAll(from(table).select(columns), match).limit(1).maybeSingle();
    return { data: (data as Record<string, unknown> | null) ?? null, error };
  },
  async rpc(name, args) {
    const { data, error } = await db.rpc(name, args);
    return { data, error };
  },
};

/**
 * Turn token target → the database's own handle. Record rows: their persistent record_refs ref
 * (created by v2_turn_input for any row in the 7-day window that has none yet — app-screen or v1
 * rows). Day-metric values: the latest live primary ledger write on that field (a value the ledger
 * never saw cannot be undone by ref → not_in_ledger, honestly).
 */
export async function liveResolveTarget(userId: string, today: string, target: TargetSpec): Promise<ResolvedTarget> {
  if (target.kind === 'unresolvable') return { ok: false, failure_class: target.reason };
  if (target.kind === 'row') {
    const lookup = () => from('record_refs').select('ref').eq('user_id', userId).eq('target_table', target.table).eq('target_id', target.id).limit(1).maybeSingle();
    let { data, error } = await lookup();
    if (!error && !data) {
      const ensured = await db.rpc('v2_turn_input', { p_user: userId, p_day: today });
      if (ensured.error) return { ok: false, failure_class: 'write_failed' };
      ({ data, error } = await lookup());
    }
    if (error) return { ok: false, failure_class: 'write_failed' };
    const ref = (data as { ref?: unknown } | null)?.ref;
    return typeof ref === 'string' ? { ok: true, ref, write_id: null } : { ok: false, failure_class: 'unknown_ref' };
  }
  const { data, error } = await from('turn_writes').select('id, ref').eq('user_id', userId).eq('table_name', 'daily_metrics')
    .eq('row_id', target.id).eq('is_primary', true).is('undone_at', null).is('reverses', null)
    .contains('field_set', [target.field]).order('seq', { ascending: false }).limit(1);
  if (error) return { ok: false, failure_class: 'write_failed' };
  const w = rowsOf(data)?.[0];
  if (!w || typeof w.id !== 'string') return { ok: false, failure_class: 'not_in_ledger' };
  return { ok: true, ref: typeof w.ref === 'string' ? w.ref : null, write_id: w.id };
}

const log = (line: string, data?: Record<string, unknown>) => {
  try { console.log(line, JSON.stringify(data ?? {})); } catch { console.log(line); }
};

/** The production V2Deps. index.ts calls this once per request with its own helpers. */
export function buildLiveV2Deps(h: IndexHelpers): V2Deps {
  const adapter = createAdapter({
    db: supabaseAdapterDb,
    helpers: { syncConstraint, appendCoachingNote, appendBehavioralPatterns, updateLayer2, createEraseHold, confirmEraseHold },
    log,
  });
  const commitPorts: Omit<CommitPorts, 'onWrite'> = {
    rpc: async (name, args) => {
      const { data, error } = await db.rpc(name, args);
      return { data, error };
    },
    resolveTarget: liveResolveTarget,
    adapter,
    log,
  };
  const turnInputDb = supabaseTurnInputDb(supabaseAdmin as unknown as PgClientLike);
  return {
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
    log,
    mark: h.mark,
    getUserId,
    checkPayloadSize,
    validateChatRequest,
    respond: h.respond,
    journal: {
      claim: h.claimOrAwaitRequest,
      commit: h.commitRequestEnvelope,
      fail: h.failRequest,
      async claimSideEffects(userId, key) {
        // Same atomic claim as v1 executeActions: at most ONE attempt per key writes.
        const { data, error } = await from('processed_chat_requests').update({ side_effects_at: new Date().toISOString() })
          .eq('user_id', userId).eq('idempotency_key', key).is('side_effects_at', null).select('idempotency_key');
        if (error) log('[v2_turn] side-effects claim failed', { error: error.message });
        return (rowsOf(data)?.length ?? 0) > 0;
      },
    },
    quota: {
      async reserve(userId, message) {
        const r = await reserveRateLimitSlot(userId, message, undefined, null, true);
        return { allowed: r.allowed, remaining: r.remaining, message: r.message, reservedMessageId: r.reservedMessageId };
      },
      async release(id) {
        const { error } = await from('chat_messages').delete().eq('id', id);
        if (error) log('[v2_turn] reservation release failed', { error: error.message });
      },
      async conversationCap(userId, alreadyCounted) {
        const r = await checkRateLimit(userId, false, alreadyCounted);
        return { allowed: r.allowed, remaining: r.remaining, message: r.message };
      },
    },
    loadTurnInput: (userId, now, tz) => loadTurnInput(turnInputDb, { userId, now, clientTimezone: tz }),
    understand: (req) => understand(req),
    commitPorts,
    adapter,
    recordEdSignal: (userId, severity) => recordEDSignal(userId, severity),
    coach: (input) => runCoach(input),
    undo: {
      async findLastTurnWrite(userId, op) {
        const { data: last } = await from('chat_messages').select('turn_id').eq('user_id', userId).eq('role', 'assistant')
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        const turnId = (last as { turn_id?: unknown } | null)?.turn_id;
        if (typeof turnId !== 'string') return null;
        const { data } = await from('turn_writes').select('id, ref').eq('user_id', userId).eq('turn_id', turnId).eq('op', op)
          .eq('is_primary', true).is('undone_at', null).is('reverses', null).order('seq', { ascending: false }).limit(1);
        const w = rowsOf(data)?.[0];
        return w && typeof w.id === 'string' ? { write_id: w.id, ref: typeof w.ref === 'string' ? w.ref : null } : null;
      },
    },
    store: {
      persist: (p) => h.storeMessages(
        p.userId, p.userMessage, p.assistantMessage, p.taskMode, p.model ?? undefined,
        Math.round(p.userMessage.length / 3.5) + Math.round(p.assistantMessage.length / 3.5),
        undefined, p.sessionId ?? undefined, p.reservedUserMessageId,
        { turnId: p.turnId, pipeline: 'v2', quotaClass: p.quotaClass, codeNotes: p.codeNotes, actionsExecuted: p.actionsExecuted },
      ),
      async linkTurnMessage(userId, turnId, chatMessageId) {
        const { error } = await db.rpc('v2_link_turn_message', { p_user: userId, p_turn_id: turnId, p_chat_message_id: chatMessageId });
        if (error) log('[v2_turn] v2_link_turn_message failed', { error: error.message });
      },
    },
    async turnLog(rows) {
      if (rows.length === 0) return;
      const { error } = await from('ai_turn_log').insert(rows);
      if (error) log('[v2_turn] ai_turn_log insert failed', { error: error.message, code: error.code ?? null });
    },
    nudge: {
      async read(userId, nudgeId) {
        const { data } = await from('coaching_messages').select('content').eq('id', nudgeId).eq('user_id', userId).limit(1).maybeSingle();
        const content = (data as { content?: unknown } | null)?.content;
        return typeof content === 'string' ? { content } : null;
      },
      async stamp(userId, nudgeId) {
        const { error } = await from('coaching_messages').update({ accepted_at: new Date().toISOString() }).eq('id', nudgeId).eq('user_id', userId);
        if (error) log('[v2_turn] nudge stamp failed', { error: error.message });
      },
    },
    schedule: scheduleBackground,
    afterCommit: h.afterCommit,
    rolloutStamp: (userId) => rolloutStamp(ACTIVE_ROLLOUT_STEPS, userId),
  };
}
