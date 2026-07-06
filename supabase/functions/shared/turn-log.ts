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
      latency_ms: receipt?.latencyMs ?? 0,
      finish_reason: receipt?.finishReason ?? null,
      fallback_reason: receipt?.fallbackReason ?? null,
      attempts: receipt?.attempts ?? 1,
      guard_verdict: guardVerdict,
    });
  } catch (e) { console.error(`[ai_turn_log] ${functionName} write failed:`, (e as Error).message); }
}
