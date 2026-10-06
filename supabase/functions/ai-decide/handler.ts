/**
 * ai-decide — permanent SERVICE-ROLE dry-run of one structured decision call
 * (docs/AI_MIMARI_V2.md §10 Faz 1: "cap-probe → kalıcı servis-rolü dry-run fonksiyonu").
 *
 * What it is for: probing strict json_schema on any model the secrets can name (terra, luna, the
 * gpt-4o / OPENAI_BASE_URL rollback path), measuring Stage A latency/usage on a real prompt, and
 * replaying eval fixtures against the live provider — WITHOUT touching user data.
 *
 * Two provider targets, chosen per request with `target`:
 *   - `default`: OPENAI_BASE_URL / OPENAI_API_KEY, i.e. exactly what live chat uses.
 *   - `probe_gateway`: the probe-only secrets KOCHKO_PROBE_BASE_URL / KOCHKO_PROBE_API_KEY. This is
 *     how a rollback gateway (Azure / OpenRouter / self-host) is probed BEFORE anyone points
 *     OPENAI_BASE_URL at it — changing that secret would reroute live v1 chat too. Both probe
 *     secrets are required: the OpenAI key is never sent to a gateway. A base URL is never taken
 *     from the request body (that would let a caller exfiltrate the key).
 *
 * Hard properties (each pinned by handler.test.ts):
 *   - NO database access of any kind: this module imports no Supabase client. It cannot write.
 *   - Service role only. config.toml keeps verify_jwt=true, so the Supabase gateway has verified
 *     the bearer JWT before we run; here we only require that the verified token is the service
 *     role (the same check the deleted model-bench / cap-probe used). The gateway rejects a
 *     non-JWT bearer, including the new `sb_secret_…` keys, so probes and the eval runner MUST
 *     send the legacy service_role JWT (`Authorization: Bearer <service_role JWT>`).
 *   - No model fallback: respond() reports a refusal / off-schema answer as what it is.
 *   - Logs carry counts and timings only — the prompt and the answer are health data.
 *
 * Kept import-free of serve() so tests can call handleDecide directly (index.ts wires it up).
 */
import {
  MODELS,
  respond,
  type ChatMessage,
  type FunctionTool,
  type ReasoningEffort,
  type RespondResult,
  type StructuredFormat,
  type StructuredSchema,
  type Transport,
} from '../shared/openai.ts';
import { SCHEMA_NAME_RE, strictSchemaIssues } from '../shared/json-schema-check.ts';

const EFFORTS: readonly ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
const FORMATS: readonly StructuredFormat[] = ['json_schema', 'json_object', 'auto'];
const ROLES: readonly ChatMessage['role'][] = ['system', 'user', 'assistant'];
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;
const MAX_BODY_CHARS = 512 * 1024;
const MAX_MESSAGES = 200;
const MAX_TOOLS = 16;
const TARGETS = ['default', 'probe_gateway'] as const;
export type DecideTarget = typeof TARGETS[number];

export interface DecideDeps {
  transport?: Transport;
  /** Defaults to SUPABASE_SERVICE_ROLE_KEY. */
  serviceRoleKey?: string;
  /**
   * Named schemas the caller may reference with `schema_name` instead of sending a raw schema.
   * Empty until shared/write-registry lands; integration passes the registry's generated map.
   */
  schemas?: Readonly<Record<string, StructuredSchema>>;
  /** Pins the `default` target. Unset → respond() uses OPENAI_BASE_URL / OPENAI_API_KEY (live chat's). */
  baseUrl?: string;
  apiKey?: string;
  /** The `probe_gateway` target. Default: KOCHKO_PROBE_BASE_URL / KOCHKO_PROBE_API_KEY; '' = not set. */
  probeBaseUrl?: string;
  probeApiKey?: string;
  now?: () => number;
}

export interface DecideRequest {
  model: string;
  effort: ReasoningEffort;
  messages: ChatMessage[];
  schema: StructuredSchema;
  format?: StructuredFormat;
  maxTokens?: number;
  cacheKey?: string;
  timeoutMs?: number;
  tools?: FunctionTool[];
  includeOutputItems: boolean;
  target: DecideTarget;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function bearerToken(req: Request): string {
  return (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
}

/** Payload claims of a JWT, WITHOUT verifying it (the gateway did, verify_jwt=true). */
export function jwtClaims(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded));
    return typeof claims === 'object' && claims !== null && !Array.isArray(claims) ? claims as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Service-role gate. In production the claim check is the one that matters: verify_jwt=true has
 * the gateway verify the JWT signature, and it rejects a non-JWT bearer before this runs — so a
 * raw `sb_secret_…` key never reaches here there, and probes must send the service_role JWT.
 * The raw-key match is defence in depth for runs WITHOUT that gateway check (`functions serve
 * --no-verify-jwt`, or if verify_jwt is ever turned off). Likewise an expired token is refused
 * even though the gateway should already have done so.
 */
export function isServiceRoleCaller(req: Request, serviceRoleKey: string, nowMs = Date.now()): boolean {
  const tok = bearerToken(req);
  if (!tok) return false;
  if (serviceRoleKey && timingSafeEqual(tok, serviceRoleKey)) return true;
  const claims = jwtClaims(tok);
  if (!claims || claims.role !== 'service_role') return false;
  if (typeof claims.exp === 'number' && claims.exp * 1000 < nowMs) return false;
  return true;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; issues?: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseSchema(raw: unknown): Parsed<StructuredSchema> {
  if (!isRecord(raw)) return { ok: false, error: 'schema must be an object {name, schema, strict?}' };
  if (typeof raw.name !== 'string' || !SCHEMA_NAME_RE.test(raw.name)) {
    return { ok: false, error: 'schema.name must match ^[A-Za-z0-9_-]{1,64}$' };
  }
  if (!isRecord(raw.schema)) return { ok: false, error: 'schema.schema must be a JSON schema object' };
  if (raw.strict !== undefined && typeof raw.strict !== 'boolean') return { ok: false, error: 'schema.strict must be boolean' };
  if (raw.description !== undefined && typeof raw.description !== 'string') return { ok: false, error: 'schema.description must be a string' };
  return {
    ok: true,
    value: {
      name: raw.name,
      schema: raw.schema,
      strict: raw.strict as boolean | undefined,
      ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    },
  };
}

function parseMessages(system: unknown, input: unknown): Parsed<ChatMessage[]> {
  if (typeof system !== 'string') return { ok: false, error: 'system must be a string' };
  const messages: ChatMessage[] = system.trim() === '' ? [] : [{ role: 'system', content: system }];
  if (typeof input === 'string') {
    if (input.trim() === '') return { ok: false, error: 'input must not be empty' };
    messages.push({ role: 'user', content: input });
    return { ok: true, value: messages };
  }
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: 'input must be a non-empty string or an array of {role, content}' };
  }
  if (input.length > MAX_MESSAGES) return { ok: false, error: `input has more than ${MAX_MESSAGES} messages` };
  for (const [i, m] of input.entries()) {
    if (!isRecord(m) || !ROLES.includes(m.role as ChatMessage['role'])) {
      return { ok: false, error: `input[${i}].role must be one of ${ROLES.join('|')}` };
    }
    if (typeof m.content !== 'string' && !Array.isArray(m.content)) {
      return { ok: false, error: `input[${i}].content must be a string or a content-part array` };
    }
    messages.push({ role: m.role as ChatMessage['role'], content: m.content as string | unknown[] });
  }
  return { ok: true, value: messages };
}

function parseTools(raw: unknown): Parsed<FunctionTool[] | undefined> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (!Array.isArray(raw) || raw.length > MAX_TOOLS) return { ok: false, error: `tools must be an array of at most ${MAX_TOOLS}` };
  const tools: FunctionTool[] = [];
  for (const [i, t] of raw.entries()) {
    if (!isRecord(t) || typeof t.name !== 'string' || !SCHEMA_NAME_RE.test(t.name) || !isRecord(t.parameters)) {
      return { ok: false, error: `tools[${i}] must be {name, parameters, description?, strict?}` };
    }
    // Never silently coerce: a string "false" would otherwise be dropped and go out as strict:true.
    if (t.strict !== undefined && typeof t.strict !== 'boolean') return { ok: false, error: `tools[${i}].strict must be boolean` };
    if (t.description !== undefined && typeof t.description !== 'string') return { ok: false, error: `tools[${i}].description must be a string` };
    // Tools go out strict unless opted out (buildRespondRequest: `t.strict !== false`), so they get
    // the same zero-token pre-flight as the main schema, with tool-indexed paths.
    if (t.strict !== false) {
      const issues = strictSchemaIssues(t.parameters);
      if (issues.length > 0) {
        return {
          ok: false,
          error: `tools[${i}].parameters is not valid for strict mode (or send strict:false on the tool)`,
          issues: issues.map((issue) => `tools[${i}].parameters${issue}`),
        };
      }
    }
    tools.push({
      type: 'function',
      name: t.name,
      parameters: t.parameters,
      ...(typeof t.description === 'string' ? { description: t.description } : {}),
      ...(typeof t.strict === 'boolean' ? { strict: t.strict } : {}),
    });
  }
  return { ok: true, value: tools };
}

/** Validate the dry-run body. Pure; every rejection names the field so a probe script can fix it. */
export function parseDecideRequest(
  body: unknown,
  schemas: Readonly<Record<string, StructuredSchema>> = {},
): Parsed<DecideRequest> {
  if (!isRecord(body)) return { ok: false, error: 'body must be a JSON object' };

  const model = body.model ?? MODELS.primary;
  if (typeof model !== 'string' || !MODEL_RE.test(model)) return { ok: false, error: 'model must be a model id string' };
  const effort = body.effort ?? 'low'; // §8.4: Stage A base effort is low, never none by default
  if (!EFFORTS.includes(effort as ReasoningEffort)) return { ok: false, error: `effort must be one of ${EFFORTS.join('|')}` };
  if (body.format !== undefined && !FORMATS.includes(body.format as StructuredFormat)) {
    return { ok: false, error: `format must be one of ${FORMATS.join('|')}` };
  }

  let schema: StructuredSchema;
  if (body.schema !== undefined && body.schema_name !== undefined) {
    return { ok: false, error: 'send either schema or schema_name, not both' };
  }
  if (body.schema_name !== undefined) {
    // OWN keys only: a plain-object lookup would resolve 'constructor' / '__proto__' / 'toString'.
    const name = body.schema_name;
    const named = typeof name === 'string' && Object.prototype.hasOwnProperty.call(schemas, name) ? schemas[name] : undefined;
    if (!named) {
      const known = Object.keys(schemas);
      return { ok: false, error: `unknown schema_name; registered: ${known.length ? known.join(', ') : '(none yet — send a raw schema)'}` };
    }
    schema = named;
  } else {
    const s = parseSchema(body.schema);
    if (!s.ok) return s;
    schema = s.value;
  }
  // Pre-flight the strict rules so a malformed probe costs 0 tokens and names the bad path.
  if (schema.strict !== false) {
    const issues = strictSchemaIssues(schema.schema);
    if (issues.length > 0) return { ok: false, error: 'schema is not valid for strict mode (or send strict:false)', issues };
  }

  const msgs = parseMessages(body.system, body.input);
  if (!msgs.ok) return msgs;

  const maxTokens = body.max_tokens;
  if (maxTokens !== undefined && (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 32_000)) {
    return { ok: false, error: 'max_tokens must be an integer in [1, 32000]' };
  }
  const timeoutMs = body.timeout_ms;
  if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs < 500 || timeoutMs > 180_000)) {
    return { ok: false, error: 'timeout_ms must be a number in [500, 180000]' };
  }
  const cacheKey = body.cache_key;
  if (cacheKey !== undefined && (typeof cacheKey !== 'string' || cacheKey.length === 0 || cacheKey.length > 128)) {
    return { ok: false, error: 'cache_key must be a string of 1-128 characters' };
  }
  const tools = parseTools(body.tools);
  if (!tools.ok) return tools;
  const target = body.target ?? 'default';
  if (!TARGETS.includes(target as DecideTarget)) return { ok: false, error: `target must be one of ${TARGETS.join('|')}` };

  return {
    ok: true,
    value: {
      model,
      effort: effort as ReasoningEffort,
      messages: msgs.value,
      schema,
      format: body.format as StructuredFormat | undefined,
      maxTokens: maxTokens as number | undefined,
      cacheKey: cacheKey as string | undefined,
      timeoutMs: timeoutMs as number | undefined,
      tools: tools.value,
      includeOutputItems: body.include_output_items === true,
      target: target as DecideTarget,
    },
  };
}

/** Where respond() is pointed. `undefined` fields fall through to respond()'s OPENAI_* defaults. */
export interface ProviderEndpoint {
  baseUrl?: string;
  apiKey?: string;
}

/**
 * Resolve the request's target to an endpoint. Pure. Config errors never echo the configured URL
 * or key. For `probe_gateway` both probe secrets are required and the URL must be https: the
 * fallback would otherwise be sending OPENAI_API_KEY to a third party.
 */
export function resolveTarget(
  target: DecideTarget,
  cfg: { baseUrl?: string; apiKey?: string; probeBaseUrl: string; probeApiKey: string },
): Parsed<ProviderEndpoint> {
  if (target === 'default') return { ok: true, value: { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey } };
  const unset = 'target probe_gateway is not configured: set the probe-only secrets KOCHKO_PROBE_BASE_URL and KOCHKO_PROBE_API_KEY (OPENAI_BASE_URL is live chat traffic and stays untouched)';
  const url = cfg.probeBaseUrl.trim();
  if (url === '') return { ok: false, error: `${unset} — KOCHKO_PROBE_BASE_URL is empty` };
  let parsed: URL | null = null;
  try { parsed = new URL(url); } catch { parsed = null; }
  if (!parsed || parsed.protocol !== 'https:') return { ok: false, error: 'KOCHKO_PROBE_BASE_URL must be an https URL' };
  const key = cfg.probeApiKey.trim();
  if (key === '') return { ok: false, error: `${unset} — KOCHKO_PROBE_API_KEY is empty (the OpenAI key is never sent to a gateway)` };
  return { ok: true, value: { baseUrl: url, apiKey: key } };
}

/** The dry-run response body. snake_case: it is consumed by probe/eval scripts, not by the app. */
export function decideResponseBody(r: RespondResult<unknown>, req: DecideRequest): Record<string, unknown> {
  return {
    dry_run: true,
    ok: r.kind === 'parsed',
    kind: r.kind,
    decision: r.kind === 'parsed' ? r.value : null,
    refusal: r.refusal,
    function_calls: r.functionCalls.map((c) => ({ call_id: c.callId, name: c.name, arguments: c.arguments, parsed_arguments: c.parsedArguments })),
    issues: r.kind === 'invalid' ? r.issues : [],
    candidate: r.kind === 'invalid' ? r.candidate : null,
    incomplete_reason: r.kind === 'incomplete' ? r.reason : null,
    error: r.kind === 'error' ? r.error : null,
    text: r.text,
    usage: {
      input_tokens: r.usage.inputTokens,
      output_tokens: r.usage.outputTokens,
      total_tokens: r.usage.totalTokens,
      reasoning_tokens: r.usage.reasoningTokens,
      cached_tokens: r.usage.cachedTokens,
    },
    latency_ms: r.latencyMs,
    model_requested: r.modelRequested,
    model_served: r.modelServed,
    provider_model: r.providerModel,
    api: r.api,
    format: r.format,
    effort: r.effort,
    attempts: r.attempts,
    retries: r.retries,
    response_id: r.responseId,
    finish_reason: r.finishReason,
    schema_name: req.schema.name,
    target: req.target,
    ...(req.includeOutputItems ? { output_items: r.outputItems } : {}),
  };
}

export async function handleDecide(req: Request, deps: DecideDeps = {}): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const serviceRoleKey = deps.serviceRoleKey ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const now = deps.now ?? Date.now;
  if (!isServiceRoleCaller(req, serviceRoleKey, now())) return json({ error: 'forbidden' }, 403);

  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) return json({ error: `body exceeds ${MAX_BODY_CHARS} characters` }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'body is not valid JSON' }, 400);
  }
  const parsed = parseDecideRequest(body, deps.schemas ?? {});
  if (!parsed.ok) return json({ error: parsed.error, issues: parsed.issues ?? [] }, 400);
  const r = parsed.value;
  const endpoint = resolveTarget(r.target, {
    baseUrl: deps.baseUrl,
    apiKey: deps.apiKey,
    probeBaseUrl: deps.probeBaseUrl ?? Deno.env.get('KOCHKO_PROBE_BASE_URL') ?? '',
    probeApiKey: deps.probeApiKey ?? Deno.env.get('KOCHKO_PROBE_API_KEY') ?? '',
  });
  if (!endpoint.ok) return json({ error: endpoint.error, issues: [] }, 400);

  const result = await respond({
    model: r.model,
    effort: r.effort,
    input: r.messages,
    schema: r.schema,
    format: r.format,
    maxTokens: r.maxTokens,
    cacheKey: r.cacheKey,
    timeoutMs: r.timeoutMs,
    tools: r.tools,
    store: false,
    baseUrl: endpoint.value.baseUrl,
    apiKey: endpoint.value.apiKey,
    transport: deps.transport,
  });

  // Counts and timings only — never the prompt or the answer (nor the endpoint or key).
  console.log(`[ai-decide] kind=${result.kind} target=${r.target} model=${result.modelRequested} api=${result.api} format=${result.format} effort=${result.effort ?? 'n/a'} ms=${result.latencyMs} in=${result.usage.inputTokens} cached=${result.usage.cachedTokens} out=${result.usage.outputTokens} reasoning=${result.usage.reasoningTokens} attempts=${result.attempts}${result.retries.length ? ` retries=${result.retries.join(',')}` : ''}`);

  // 200 for every upstream outcome: the probe's job is to REPORT a refusal/400, not to fail on it.
  return json(decideResponseBody(result, r), 200);
}
