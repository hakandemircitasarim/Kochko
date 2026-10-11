/**
 * ai-chat/v2/route.ts — v1 or v2 for this request (AI_MIMARI_V2 §3.2 "serve() ──rolloutMode('v2_turn')──▶").
 *
 *   KOCHKO_ROLLOUT_V2_TURN unset / off  → v1 handleChat, untouched: no clone, no decode, no extra I/O.
 *   set (allowlist / pct / on)          → the request's user is routed by rolloutMode('v2_turn');
 *                                         'on' runs the v2 turn, everything else v1.
 *   v2 says fallback_v1                 → its cleanup runs (journal claim, quota reservation) and v1
 *                                         answers the ORIGINAL request (a clone kept for this).
 *   v2 crashes before any side effect   → logged, cleanup, v1 answers.
 *   v2 crashes after a side effect      → NO v1 re-run (it would write twice): an honest answer with
 *                                         whatever was really written.
 *
 * Rollback is the secret alone: `supabase secrets set KOCHKO_ROLLOUT_V2_TURN=off` — the next request
 * takes the first branch.
 */
import { rolloutEnvKey, type RolloutMode } from '../../shared/rollout.ts';
import { newTurnState, type TurnState, type V2Outcome } from './handler.ts';

export const V2_TURN_STEP = 'v2_turn';

const OFF_WORDS: ReadonlySet<string> = new Set(['off', '0', 'false', 'no', '']);

function envGet(key: string): string | null {
  try {
    return Deno.env.get(key) ?? null;
  } catch {
    return null;
  }
}

/** Is the v2_turn key set to anything but off? (Unset = off: v2 steps ignore KOCHKO_ROLLOUT_DEFAULT.) */
export function v2TurnConfigured(read: (key: string) => string | null = envGet): boolean {
  const raw = read(rolloutEnvKey(V2_TURN_STEP));
  return raw !== null && !OFF_WORDS.has(raw.trim().toLowerCase());
}

function base64UrlDecode(s: string): string {
  const b64 = s.split('-').join('+').split('_').join('/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return atob(b64 + pad);
}

/**
 * The user id to ROUTE on: the bearer JWT's `sub`, read WITHOUT verification — it only picks a
 * pipeline; the v2 handler verifies the token itself (getUserId) and hands a mismatch back to v1.
 * A service-to-service call (service key + x-user-id) routes on the header the same way.
 */
export function routingUserId(req: Request): string | null {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth.trim();
  const headerUser = (req.headers.get('x-user-id') ?? '').trim() || null;
  const parts = token.split('.');
  if (parts.length !== 3) return headerUser;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>;
    if (typeof payload.sub === 'string' && payload.sub) return payload.sub;
  } catch {
    return headerUser;
  }
  return headerUser;
}

export interface RouteDeps {
  configured(): boolean;
  mode(userId: string): RolloutMode;
  v1(req: Request): Promise<Response>;
  v2(req: Request, routedUserId: string, state: TurnState): Promise<V2Outcome>;
  /** After a side effect: never v1 again — answer honestly from TurnState. */
  honest(state: TurnState, error: unknown): Promise<Response>;
  log(line: string, data: Record<string, unknown>): void;
}

async function runCleanup(state: TurnState, log: RouteDeps['log']): Promise<void> {
  for (const job of state.cleanup) {
    try { await job(); } catch (e) { log('[v2_route] cleanup failed', { error: (e as Error)?.message ?? String(e) }); }
  }
  state.cleanup = [];
}

export async function routeTurn(req: Request, d: RouteDeps): Promise<Response> {
  if (req.method !== 'POST' || !d.configured()) return await d.v1(req);
  const uid = routingUserId(req);
  if (!uid || d.mode(uid) !== 'on') return await d.v1(req);
  const v1Req = req.clone();
  const state = newTurnState();
  try {
    const out = await d.v2(req, uid, state);
    if (out.kind === 'response') return out.response;
    d.log('[v2_route] handed to v1', { reason: out.reason, turn_id: state.turnId });
    await runCleanup(state, d.log);
    return await d.v1(v1Req);
  } catch (e) {
    const error = (e as Error)?.message ?? String(e);
    d.log('[v2_route] v2 crashed', { error: error.slice(0, 300), side_effects: state.sideEffects, turn_id: state.turnId });
    if (!state.sideEffects) {
      await runCleanup(state, d.log);
      return await d.v1(v1Req);
    }
    return await d.honest(state, e);
  }
}
