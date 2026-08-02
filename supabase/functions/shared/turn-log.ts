/**
 * turn-log.ts — one place to write the ai_turn_log observability ledger (target-arch step 5).
 *
 * The openai.ts UsageReceipt is emitted per LLM call; this persists it fail-loud so cost, the
 * actually-served model, latency, and fallbacks are visible for EVERY function (ai-chat, ai-plan,
 * ai-proactive…), not just chat. Never throws — a ledger failure must not break the turn.
 */
import { supabaseAdmin } from './supabase-admin.ts';
import type { UsageReceipt } from './openai.ts';

export async function writeTurnLog(
  userId: string,
  functionName: string,
  systemMode: string | null,
  receipt: UsageReceipt | null,
  guardVerdict = 'clean',
): Promise<void> {
  try {
    await supabaseAdmin.from('ai_turn_log').insert({
      user_id: userId,
      function_name: functionName,
      system_mode: systemMode,
      model_requested: receipt?.modelRequested ?? 'unknown',
      model_served: receipt?.modelServed ?? 'unknown',
      prompt_tokens: receipt?.promptTokens ?? 0,
      completion_tokens: receipt?.completionTokens ?? 0,
      total_tokens: receipt?.totalTokens ?? 0,
      // migration 104: thinking is billed as output, so without this column an expensive ANSWER
      // and expensive THINKING are indistinguishable — and thinking is the lever we control.
      reasoning_tokens: receipt?.reasoningTokens ?? 0,
      latency_ms: receipt?.latencyMs ?? 0,
      finish_reason: receipt?.finishReason ?? null,
      fallback_reason: receipt?.fallbackReason ?? null,
      attempts: receipt?.attempts ?? 1,
      guard_verdict: guardVerdict,
    });
  } catch (e) { console.error(`[ai_turn_log] ${functionName} write failed:`, (e as Error).message); }
}

/** One captured-fact receipt: which field, what value, which capture path, did the row REALLY change. */
export interface FactReceipt {
  field: string;
  value: unknown;
  source: 'model' | 'regex' | 'net';
  verified: boolean;
}

/**
 * #S2 (structural rebuild): persist the per-turn fact-capture receipts. This is the audit trail
 * that makes "the coach said it saved but nothing was written" IMPOSSIBLE to miss — every captured
 * fact gets a row stating whether the canonical store verifiably changed. Fail-quiet like the
 * ledger itself: a receipt failure must never break the turn.
 */
export async function writeFactReceipts(userId: string, facts: FactReceipt[]): Promise<void> {
  if (!facts.length) return;
  try {
    await supabaseAdmin.from('ai_turn_log').insert({
      user_id: userId,
      function_name: 'fact-capture',
      system_mode: null,
      model_requested: 'none', model_served: 'none',
      prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, latency_ms: 0,
      guard_verdict: facts.every(f => f.verified) ? 'clean' : 'unverified_write',
      facts_captured: facts,
    });
  } catch (e) { console.error('[fact-receipts] write failed:', (e as Error).message); }
}
