/**
 * Live-run pre-flight: before a single paid call, every Stage A body the run would send is built
 * with production's builder and handed to ai-decide's OWN request parser (parseDecideRequest — the
 * same function the endpoint runs, incl. the strict-schema pre-check) and size limit. A body the
 * endpoint would 400/413 is found here for $0, not after 700 calls.
 *
 * Also counts what the run will cost: T2 explicit hits and non-chat / T1 fixtures make no call.
 * The cost is an ESTIMATE from the one shared token estimator (write-registry/tokens.ts) and the
 * §3.3 price table; live usage numbers replace it in the report.
 *
 * Pure (no network, no key): `--dry-run` stops here after the key file's shape is checked.
 */
import type { EvalFixture } from './types.ts';
import { buildFixtureRequest, fixtureT2 } from './request.ts';
import { PRICES } from './gates.ts';
import { estimateTokens } from '../../../shared/write-registry/mod.ts';
import { MAX_BODY_CHARS, parseDecideRequest } from '../../../ai-decide/handler.ts';

/** §3.3: ≤350 output+reasoning tokens per Stage A call (upper end of the estimate). */
export const STAGE_A_OUTPUT_TOKENS_EST = 350;

export interface PreflightIssue { fixture_id: string; error: string }

export interface Preflight {
  model: string;
  reps: number;
  /** Fixtures that will call Stage A, and the call count (× reps). */
  fixtures_called: number;
  calls: number;
  /** Explicit T2 hits: the canned reply answers, Stage A is never called (as in production). */
  canned: number;
  /** Non-chat pipelines and T1 client protocols: not run through Stage A yet. */
  not_called: number;
  issues: PreflightIssue[];
  largest_body_chars: number;
  /** Cached prefix (system + strict schema), estimated tokens. */
  prefix_tokens_est: number;
  cost_usd_est: number | null;
}

export function preflight(fixtures: readonly EvalFixture[], opts: { model: string; reps: number }): Preflight {
  const issues: PreflightIssue[] = [];
  let fixtures_called = 0;
  let canned = 0;
  let not_called = 0;
  let largest = 0;
  let userTokens = 0;
  let prefixTokens = 0;
  for (const f of fixtures) {
    if ((f.pipeline ?? 'chat') !== 'chat' || f.client) {
      not_called++;
      continue;
    }
    const t2 = fixtureT2(f.message);
    if (t2.floor.kind === 'canned') {
      canned++;
      continue;
    }
    let body: unknown;
    try {
      body = JSON.parse(JSON.stringify(buildFixtureRequest(f, opts.model, t2.scan)));
    } catch (err) {
      issues.push({ fixture_id: f.id, error: `istek kurulamadı: ${(err as Error).message}` });
      continue;
    }
    const chars = JSON.stringify(body).length;
    largest = Math.max(largest, chars);
    if (chars > MAX_BODY_CHARS) issues.push({ fixture_id: f.id, error: `gövde ${chars} karakter > ai-decide sınırı ${MAX_BODY_CHARS} (413)` });
    const parsed = parseDecideRequest(body);
    if (!parsed.ok) {
      issues.push({ fixture_id: f.id, error: `ai-decide reddeder (400): ${parsed.error}${parsed.issues?.length ? ` — ${parsed.issues.slice(0, 3).join(' | ')}` : ''}` });
      continue;
    }
    const b = body as { system: string; input: { content: string }[]; schema: { schema: unknown } };
    prefixTokens ||= estimateTokens(b.system) + estimateTokens(JSON.stringify(b.schema.schema));
    userTokens += estimateTokens(b.input.map((m) => m.content).join('\n'));
    fixtures_called++;
  }
  const reps = Math.max(1, opts.reps);
  const calls = fixtures_called * reps;
  const p = PRICES[opts.model];
  // Warm: the prefix is read from the global cache; the first call writes it at the full price.
  const cost_usd_est = p && calls
    ? Number((((prefixTokens * p[1] + STAGE_A_OUTPUT_TOKENS_EST * p[2]) * calls + userTokens * reps * p[0] + prefixTokens * (p[0] - p[1])) / 1e6).toFixed(2))
    : null;
  return {
    model: opts.model, reps, fixtures_called, calls, canned, not_called, issues,
    largest_body_chars: largest, prefix_tokens_est: prefixTokens, cost_usd_est,
  };
}

export function formatPreflight(p: Preflight): string {
  const lines = [
    `Ön kontrol (ai-decide ayrıştırıcısı, ağ yok): ${p.fixtures_called} fixture × ${p.reps} tekrar = ${p.calls} Stage A çağrısı · ` +
    `${p.canned} açık tetik hazır cevapla (çağrı yok) · ${p.not_called} bağlı olmayan hat/T1 protokolü`,
    `  önbellekli önek ≈${p.prefix_tokens_est} token (tahmin) · en büyük gövde ${p.largest_body_chars} karakter (sınır ${MAX_BODY_CHARS})` +
    (p.cost_usd_est !== null ? ` · tahmini maliyet ≈ $${p.cost_usd_est} (${p.model})` : ''),
  ];
  if (p.issues.length) {
    lines.push(`  ${p.issues.length} istek ai-decide'a gönderilemez:`);
    for (const i of p.issues.slice(0, 20)) lines.push(`    ${i.fixture_id}: ${i.error}`);
  }
  return lines.join('\n');
}
