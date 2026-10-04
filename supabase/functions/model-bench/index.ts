/**
 * TEMPORARY model benchmark (2026-10-04). Service-role only; deleted after the model decision.
 *
 * Replays a production-shaped ai-chat prompt (base prompt + mode instructions + the real context
 * layers of a TEST user + their transcript) against a given model/effort and reports latency,
 * token usage and the raw output — no fallback, no DB writes, no retries.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { BASE_SYSTEM_PROMPT } from '../ai-chat/system-prompt.ts';
import { getModeInstructions, type TaskMode } from '../ai-chat/task-modes.ts';
import { analyzeMessage, getRetrievalPlan } from '../shared/retrieval-planner.ts';
import { buildContextFromPlan } from '../shared/context-builders.ts';

const KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const BASE = (Deno.env.get('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

serve(async (req) => {
  if ((req.headers.get('Authorization') ?? '') !== `Bearer ${SR}` || !SR) return new Response('forbidden', { status: 403 });
  const { user_id, message, mode, model, effort, max_tokens } = await req.json();
  const analysis = analyzeMessage(message, mode as TaskMode);
  const plan = getRetrievalPlan(analysis);
  const ctx = await buildContextFromPlan(user_id, plan);
  const stable = [BASE_SYSTEM_PROMPT,
    ctx.layer1 ? `--- KULLANICI HAKKINDA ---\n\n${ctx.layer1}` : '',
    ctx.layer2 ? `--- AI OZETI ---\n\n${ctx.layer2}` : ''].filter(Boolean).join('\n\n');
  const turn = [getModeInstructions(mode as TaskMode), ctx.layer3 ? `--- SON VERILER ---\n\n${ctx.layer3}` : ''].filter(Boolean).join('\n\n');
  const input = [
    { role: 'system', content: stable },
    ...ctx.layer4.map((m) => ({ role: m.role, content: m.content })),
    { role: 'system', content: turn },
    { role: 'user', content: message },
  ];
  const body: Record<string, unknown> = {
    model, input, max_output_tokens: max_tokens ?? 6000,
    text: { format: { type: 'json_object' } },
    prompt_cache_key: `bench:${user_id}`,
  };
  if (effort) body.reasoning = { effort };
  const t0 = Date.now();
  const r = await fetch(`${BASE}/responses`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const latency = Date.now() - t0;
  const data = await r.json();
  if (!r.ok) return Response.json({ ok: false, status: r.status, latency, error: data?.error?.message ?? data }, { status: 200 });
  let text = typeof data.output_text === 'string' ? data.output_text : '';
  if (!text) for (const it of data.output ?? []) if (it.type === 'message') for (const p of it.content ?? []) if (p.type === 'output_text') text += p.text;
  return Response.json({ ok: true, latency, usage: data.usage, status: data.status, text, prompt_chars: JSON.stringify(input).length });
});
