/**
 * LLM transport ports for the eval runner.
 *
 *  - endpointTransport: POSTs the Stage A body to the service-role dry-run function `ai-decide`
 *    (§10 Faz 1). The key is held in a closure and only ever placed in request headers — never in a
 *    payload, an error string, a replay entry or a report.
 *  - fakeDecideTransport: offline stand-in that answers in ai-decide's OWN response shape (so the
 *    same normalisation runs); unit tests, golden decisions and `--mode fake`.
 *  - localTransport:    an in-process function returning an LlmResponse (judge tests).
 *  - replayTransport:   reads `.replay/` (key = sha256 of the canonical body) — CI mode.
 *  - recordingTransport: wraps a live transport and stores every MODEL answer at its rep index.
 *
 * ai-decide CONTRACT (supabase/functions/ai-decide/handler.ts — the endpoint's, not ours):
 *   POST {SUPABASE_URL}/functions/v1/ai-decide   Authorization: Bearer <service_role JWT>
 *   body  { model, effort, system, input: [{role, content}], schema: {name, schema, strict}, cache_key }
 *         (= ai-chat/v2/stage-a-request.ts buildStageARequest(); judge calls use the same keys)
 *   200   { dry_run, ok, kind: parsed|refusal|invalid|incomplete|function_call|error, decision,
 *           refusal, issues, candidate, incomplete_reason, error: {class,status,message}|null,
 *           text, usage{input_tokens, output_tokens, total_tokens, reasoning_tokens, cached_tokens},
 *           latency_ms, model_requested, model_served, … }
 *   400/403/413  { error, issues? }      (a bad request / not service role — infrastructure)
 *
 * Classification (runner.ts): parsed → decision; refusal / invalid / incomplete / function_call →
 * the MODEL's failure (decision stage = error, the fixture fails); kind error, HTTP errors and
 * network failures → harness error (the gate becomes EKSİK, never green, never red).
 */
import type { CacheClass, Usage } from './types.ts';
import type { ReplayStore } from './replay-store.ts';

export type ResponseKind = 'parsed' | 'refusal' | 'invalid' | 'incomplete' | 'function_call' | 'error';
const MODEL_KINDS: readonly ResponseKind[] = ['parsed', 'refusal', 'invalid', 'incomplete', 'function_call'];

export interface LlmResponse {
  ok: boolean;
  status?: number;
  kind?: ResponseKind;
  error?: string;
  /** Raw output text; parsed by the runner when no decision object came back. */
  text?: string;
  /** Already-parsed decision (ai-decide parses and validates server-side). */
  decision?: unknown;
  refusal?: string | null;
  /** ai-decide's local schema issues for kind=invalid (or the incomplete reason). */
  issues?: string[];
  usage?: Usage;
  latency_ms?: number;
  model_served?: string;
}

export interface LlmCall {
  fixture_id: string;
  rep: number;
  payload: Record<string, unknown>;
  /** sha256(canonicalJson(payload)) — computed once by the runner. */
  key: string;
}

export interface TransportResult { response: LlmResponse; cache: CacheClass }
export interface LlmTransport { name: string; call(c: LlmCall): Promise<TransportResult> }

/** A recorded/graded MODEL behaviour (incl. refusals and off-schema answers) vs an infra failure. */
export function isModelAnswer(r: LlmResponse): boolean {
  if (r.kind) return MODEL_KINDS.includes(r.kind);
  return r.ok || !!r.refusal;
}

/** Decision from the response. A refusal, an off-schema / truncated answer or unparseable text is
 *  the MODEL's failure (decision stage = error), not a harness error. */
export function parseDecision(resp: LlmResponse): { decision?: unknown; error?: string; schema_issues?: string[] } {
  if (resp.refusal || resp.kind === 'refusal') return { error: `ret: ${resp.refusal ?? '?'}` };
  if (resp.kind === 'invalid') return { error: `şema/JSON geçersiz: ${(resp.issues ?? []).slice(0, 3).join(' | ') || '?'}`, schema_issues: resp.issues ?? [] };
  if (resp.kind === 'incomplete') return { error: `yarım çıktı: ${(resp.issues ?? []).join(' ') || 'incomplete'}` };
  if (resp.kind === 'function_call') return { error: 'karar yerine araç çağrısı döndü' };
  if (resp.decision && typeof resp.decision === 'object' && !Array.isArray(resp.decision)) return { decision: resp.decision };
  if (typeof resp.text !== 'string' || !resp.text.trim()) return { error: 'boş çıktı' };
  try {
    const d = JSON.parse(resp.text);
    if (!d || typeof d !== 'object' || Array.isArray(d)) return { error: 'çıktı JSON nesnesi değil' };
    return { decision: d };
  } catch (err) {
    return { error: `JSON ayrıştırılamadı: ${(err as Error).message}` };
  }
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function normUsage(u: unknown): Usage | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const o = u as Record<string, unknown>;
  const inDet = (o.input_tokens_details ?? {}) as Record<string, unknown>;
  const outDet = (o.output_tokens_details ?? {}) as Record<string, unknown>;
  return {
    input_tokens: num(o.input_tokens),
    output_tokens: num(o.output_tokens),
    cached_tokens: num(o.cached_tokens) ?? num(inDet.cached_tokens),
    reasoning_tokens: num(o.reasoning_tokens) ?? num(outDet.reasoning_tokens),
  };
}

/** ai-decide's dry-run body (or its 4xx error body) → LlmResponse. */
export function normalizeLlmResponse(raw: unknown, httpStatus?: number): LlmResponse {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, status: httpStatus, error: 'yanıt JSON nesnesi değil' };
  const o = raw as Record<string, unknown>;
  const kind = typeof o.kind === 'string' && (MODEL_KINDS as readonly string[]).concat('error').includes(o.kind) ? o.kind as ResponseKind : undefined;
  const err = o.error;
  const error = typeof err === 'string' ? err : err && typeof err === 'object' ? String((err as Record<string, unknown>).message ?? 'hata') : undefined;
  const ok = typeof o.ok === 'boolean' ? o.ok : !error && (httpStatus === undefined || httpStatus < 400);
  const issues = Array.isArray(o.issues) ? (o.issues as unknown[]).map(String) : undefined;
  const incomplete = typeof o.incomplete_reason === 'string' ? [o.incomplete_reason] : undefined;
  return {
    ok,
    status: num(o.status) ?? httpStatus,
    kind,
    error,
    text: typeof o.text === 'string' ? o.text : undefined,
    decision: o.decision ?? undefined,
    refusal: typeof o.refusal === 'string' ? o.refusal : null,
    issues: kind === 'incomplete' ? incomplete ?? issues : issues,
    usage: normUsage(o.usage),
    latency_ms: num(o.latency_ms),
    model_served: typeof o.model_served === 'string' ? o.model_served : undefined,
  };
}

export interface EndpointOptions {
  url: string;
  key: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  /** The DB lives in ap-southeast-1; pin the function there like the client does (edgeHeaders.ts). */
  region?: string | null;
}

export function endpointTransport(opts: EndpointOptions): LlmTransport {
  const f = opts.fetchFn ?? fetch;
  const key = opts.key;
  return {
    name: 'ai-decide',
    async call(c) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 90_000);
      const t0 = Date.now();
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${key}`,
          apikey: key,
          'Content-Type': 'application/json',
        };
        if (opts.region !== null) headers['x-region'] = opts.region ?? 'ap-southeast-1';
        const r = await f(opts.url, { method: 'POST', headers, body: JSON.stringify(c.payload), signal: ctl.signal });
        const bodyText = await r.text();
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(bodyText);
        } catch { /* non-JSON gateway error page */ }
        const resp: LlmResponse = parsed ? normalizeLlmResponse(parsed, r.status) : { ok: false, status: r.status, error: `HTTP ${r.status} (JSON olmayan gövde)` };
        if (!r.ok) {
          resp.ok = false;
          resp.kind = 'error'; // a 4xx/5xx from the function is never a model answer
          if (r.status === 401 || r.status === 403) resp.error = `HTTP ${r.status}: ai-decide yalnız service_role JWT kabul eder (${resp.error ?? 'yetkisiz'})`;
        }
        resp.latency_ms ??= Date.now() - t0;
        return { response: scrub(resp, key), cache: 'live' };
      } catch (err) {
        const msg = (err as Error).name === 'AbortError' ? 'zaman aşımı' : (err as Error).message;
        return { response: scrub({ ok: false, kind: 'error', error: `bağlantı hatası: ${msg}`, latency_ms: Date.now() - t0 }, key), cache: 'live' };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Belt and braces: if any string field ever echoes the key, mask it before it leaves here. */
function scrub(r: LlmResponse, key: string): LlmResponse {
  if (!key) return r;
  const s = JSON.stringify(r);
  return s.includes(key) ? (JSON.parse(s.split(key).join('[gizli]')) as LlmResponse) : r;
}

/** What an offline fake decides for one call. */
export type FakeAnswer =
  | { decision: unknown; usage?: Usage; latency_ms?: number }
  | { refusal: string }
  | { invalid: string[]; candidate?: unknown }
  | { error: string };

/**
 * Offline ai-decide: `answer(body, call)` returns a decision (or a refusal / an off-schema answer /
 * an infra error), wrapped in ai-decide's response body and passed through normalizeLlmResponse —
 * the exact path a live answer takes. The body it receives is the real Stage A request.
 */
export function fakeDecideTransport(answer: (body: Record<string, unknown>, call: LlmCall) => FakeAnswer | Promise<FakeAnswer>): LlmTransport {
  return {
    name: 'fake',
    async call(c) {
      const a = await answer(c.payload, c);
      let body: Record<string, unknown>;
      if ('decision' in a) body = { dry_run: true, ok: true, kind: 'parsed', decision: a.decision, refusal: null, issues: [], error: null, usage: a.usage ?? {}, latency_ms: a.latency_ms ?? 0, model_served: String(c.payload.model ?? '') };
      else if ('refusal' in a) body = { dry_run: true, ok: false, kind: 'refusal', decision: null, refusal: a.refusal, issues: [], error: null };
      else if ('invalid' in a) body = { dry_run: true, ok: false, kind: 'invalid', decision: null, refusal: null, issues: a.invalid, candidate: a.candidate ?? null, error: null };
      else body = { dry_run: true, ok: false, kind: 'error', decision: null, refusal: null, issues: [], error: { class: 'network', status: null, message: a.error } };
      return { response: normalizeLlmResponse(body, 200), cache: 'local' };
    },
  };
}

export function localTransport(fn: (payload: Record<string, unknown>, call: LlmCall) => LlmResponse | Promise<LlmResponse>): LlmTransport {
  return {
    name: 'local',
    async call(c) {
      const t0 = Date.now();
      const response = await fn(c.payload, c);
      return { response: { ...response, latency_ms: response.latency_ms ?? Date.now() - t0 }, cache: 'local' };
    },
  };
}

export function replayTransport(store: ReplayStore): LlmTransport {
  return {
    name: 'replay',
    async call(c) {
      const entry = await store.get(c.key);
      const response = entry?.responses[c.rep] ?? null;
      if (!response) return { response: { ok: false, kind: 'error', error: 'replay_miss' }, cache: 'miss' };
      return { response, cache: 'hit' };
    },
  };
}

/**
 * Live + record. Each MODEL answer (refusals and off-schema answers included — they are behaviour)
 * is stored at ITS rep index, so replay rep i reads exactly what rep i got. An infra failure is not
 * recorded: that rep stays a hole and replays as a miss (EKSİK), never as someone else's answer.
 */
export function recordingTransport(inner: LlmTransport, store: ReplayStore): LlmTransport {
  return {
    name: `${inner.name}+record`,
    async call(c) {
      const res = await inner.call(c);
      if (isModelAnswer(res.response)) await store.put(c.key, c.fixture_id, c.rep, res.response);
      return res;
    },
  };
}
