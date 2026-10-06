/**
 * LLM transport ports for the eval runner.
 *
 *  - endpointTransport: POSTs to the service-role dry-run function `ai-decide` (§10 Faz 1). The key
 *    is held in a closure and only ever placed in request headers — never in a payload, an error
 *    string, a replay entry or a report.
 *  - localTransport:    an in-process function; offline unit tests and golden decisions.
 *  - replayTransport:   reads `.replay/` (key = sha256 of the canonical payload) — CI mode.
 *  - recordingTransport: wraps a live transport and appends every OK answer to the replay store.
 *
 * ai-decide EVAL CONTRACT (what this runner sends; the endpoint owner reconciles at integration):
 *   POST {SUPABASE_URL}/functions/v1/ai-decide
 *   { "mode": "raw",  "request": <Responses API body: model, input, text.format json_schema, reasoning, store:false> }
 *   { "mode": "turn", "turn_input": {…}, "message": "…", "client": {…}|null, "model": "…", "effort": "…" }
 *   → { ok, status?, error?, latency_ms?, usage?, text?, decision?, refusal?, model_served?,
 *       validation?, commit?, receipts? }      (no DB writes, no reply, no commit — dry run)
 */
import type { CacheClass, Usage } from './types.ts';
import type { ReplayStore } from './replay-store.ts';

export interface LlmResponse {
  ok: boolean;
  status?: number;
  error?: string;
  /** Raw output text; the runner parses it so a parse failure is attributed to the model. */
  text?: string;
  /** Already-parsed decision (ai-decide may parse server-side). */
  decision?: unknown;
  refusal?: string | null;
  validation?: unknown;
  commit?: unknown;
  receipts?: unknown;
  reply?: unknown;
  envelope?: unknown;
  facts?: unknown;
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

/** Decision from the response: pre-parsed object, else JSON text. A refusal or unparseable text is
 *  the MODEL's failure (decision stage = error), not a harness error. */
export function parseDecision(resp: LlmResponse): { decision?: unknown; error?: string } {
  if (resp.refusal) return { error: `ret: ${resp.refusal}` };
  if (resp.decision && typeof resp.decision === 'object') return { decision: resp.decision };
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
    input_tokens: num(o.input_tokens) ?? num(o.in),
    output_tokens: num(o.output_tokens) ?? num(o.out),
    cached_tokens: num(inDet.cached_tokens) ?? num(o.cached_tokens) ?? num(o.cached),
    reasoning_tokens: num(outDet.reasoning_tokens) ?? num(o.reasoning_tokens) ?? num(o.reasoning),
  };
}

/** Accept ai-decide's envelope, a model-bench style `{ok,text}`, or a raw Responses API object. */
export function normalizeLlmResponse(raw: unknown, httpStatus?: number): LlmResponse {
  if (!raw || typeof raw !== 'object') return { ok: false, status: httpStatus, error: 'yanıt JSON nesnesi değil' };
  const o = raw as Record<string, unknown>;
  let text = typeof o.text === 'string' ? o.text : typeof o.output_text === 'string' ? o.output_text : undefined;
  let refusal = typeof o.refusal === 'string' ? o.refusal : null;
  if (text === undefined && Array.isArray(o.output)) {
    let acc = '';
    for (const it of o.output as Record<string, unknown>[]) {
      if (it?.type !== 'message' || !Array.isArray(it.content)) continue;
      for (const p of it.content as Record<string, unknown>[]) {
        if (p?.type === 'output_text' && typeof p.text === 'string') acc += p.text;
        if (p?.type === 'refusal' && typeof p.refusal === 'string') refusal = p.refusal;
      }
    }
    if (acc) text = acc;
  }
  const err = o.error;
  const error = typeof err === 'string' ? err : err && typeof err === 'object' ? String((err as Record<string, unknown>).message ?? 'hata') : undefined;
  const ok = typeof o.ok === 'boolean' ? o.ok : !error && (httpStatus === undefined || httpStatus < 400);
  return {
    ok,
    status: num(o.status) ?? httpStatus,
    error,
    text,
    decision: o.decision ?? o.parsed,
    refusal,
    validation: o.validation,
    commit: o.commit,
    receipts: o.receipts,
    reply: o.reply,
    envelope: o.envelope,
    facts: o.facts,
    usage: normUsage(o.usage),
    latency_ms: num(o.latency_ms) ?? num(o.latency) ?? num(o.ms),
    model_served: typeof o.model_served === 'string' ? o.model_served : typeof o.model === 'string' ? o.model : undefined,
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
    name: 'endpoint',
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
        const resp = parsed ? normalizeLlmResponse(parsed, r.status) : { ok: false, status: r.status, error: `HTTP ${r.status} (JSON olmayan gövde)` };
        if (!r.ok) resp.ok = false;
        resp.latency_ms ??= Date.now() - t0;
        return { response: scrub(resp, key), cache: 'live' };
      } catch (err) {
        const msg = (err as Error).name === 'AbortError' ? 'zaman aşımı' : (err as Error).message;
        return { response: scrub({ ok: false, error: `bağlantı hatası: ${msg}`, latency_ms: Date.now() - t0 }, key), cache: 'live' };
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
      const response = entry?.responses[c.rep];
      if (!response) return { response: { ok: false, error: 'replay_miss' }, cache: 'miss' };
      return { response, cache: 'hit' };
    },
  };
}

/** Live + record. Only OK answers are recorded: an HTTP 500 is not the model's behaviour. */
export function recordingTransport(inner: LlmTransport, store: ReplayStore): LlmTransport {
  return {
    name: `${inner.name}+record`,
    async call(c) {
      const res = await inner.call(c);
      if (res.response.ok) await store.append(c.key, c.fixture_id, res.response);
      return res;
    },
  };
}
