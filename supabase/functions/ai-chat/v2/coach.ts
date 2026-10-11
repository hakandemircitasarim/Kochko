/**
 * ai-chat/v2/coach.ts — T6: Stage B, the coach speaks (AI_MIMARI_V2 §3.2 T6, §8.2, §8.4, §7.2).
 *
 * Stage B never writes a record. It runs AFTER the commit and is told, as facts, what really
 * happened; its prompt can therefore be only a coach:
 *
 *   system   constitution + exemplar dialogues + the registry's capability list — byte-stable, no
 *            clock or user data, cached per user (coachCacheKey)                       ← the prefix
 *   history  the recent conversation, every assistant turn annotated with its receipts ⟦…⟧
 *   user     KULLANICI DURUMU → (EK OLGULAR) → (this turn's contract) → BU TURDA OLANLAR →
 *            (GÜVENLİK DURUMU) → KULLANICI MESAJI                              (facts.ts renders)
 *   schema   the registry's strict 'kochko_reply_vN': suggested_foods / suggested_exercises BEFORE
 *            reply, then why · memory · ui · referral_included (§8.2, §7.1)
 *   effort   §8.4 — low; medium for a crisis/ED/compensation/analysis/plan route, an ED tier ≥ amber
 *            (or unread), or a protective tripwire — only from facts code holds
 *
 * A protective tripwire resolution adds the crisis (or ED-support) contract and a 6 s budget: when
 * Stage B fails or is late, the post-check sends the ready-made safety reply (§7.2).
 *
 * runCoach() is ONE generation and never throws; it is the T6 CoachPort (ports.ts stageBPorts wraps
 * it in runCoachWithin, bounded by what is left of the turn's ONE Stage B budget — budgets.ts). The
 * T6+T7 orchestration (first call → post-check port → the ONE regen → the code-owned guarantees) is
 * ports.ts runStageB, the same one the handler runs.
 */
import type { CoachContract, CoachInput, CoachReply, CoachRun, RegenNote } from './contracts.ts';
import { COACH_TIMEOUT_MS, CRISIS_TIMEOUT_MS, withinBudget } from './budgets.ts';
import { buildCoachPrefix, coachCacheKey } from './coach-constitution.ts';
import { stripMachineMarkers } from './envelope.ts';
import { buildStageBFacts, FACT_BLOCK_TITLES, renderStageBFacts, type StageBFacts } from './facts.ts';
import { edTierOf } from './input.ts';
import {
  type ChatMessage, MODELS, type ReasoningEffort, respond, type StructuredSchema, type Transport,
} from '../../shared/openai.ts';
import { buildCapabilities, buildReplySchema, SCHEMA_NAMES } from '../../shared/write-registry/mod.ts';

export { COACH_TIMEOUT_MS, coachTurnBudgetMs, CRISIS_TIMEOUT_MS } from './budgets.ts';
export type { CoachContract, CoachRun, CoachStatus } from './contracts.ts';

/** Visible-output budget (a reply ≤ 4000 chars + suggestion lists); respond() adds the reasoning reserve. */
export const COACH_MAX_OUTPUT_TOKENS = 1_800;

/** How much of the conversation Stage B sees (oldest dropped first) and how long one line may be. */
export const COACH_HISTORY_MESSAGES = 8;
const HISTORY_CHARS = { user: 600, assistant: 1200 } as const;

/** Stage B model: KOCHKO_MODEL_COACH, else the chat tier (terra). */
export function coachModel(): string {
  let own = '';
  try { own = Deno.env.get('KOCHKO_MODEL_COACH') ?? ''; } catch { /* no env permission */ }
  return own.trim() || MODELS.primary;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// ─── route: contract + effort (§8.2 item 4, §8.4) ─────────────────────────────────────────────────

/** The contract this turn runs under — the tripwire resolution first, then Stage A's route. */
export function coachContract(input: CoachInput): CoachContract {
  const t = input.tripwire;
  if (t.kind === 'protective') return t.route === 'ed_support' ? 'ed_support' : t.category === 'emergency' ? 'emergency' : 'crisis';
  const route = isRec(input.decision.reply_route) ? input.decision.reply_route.contract : null;
  if (route === 'emergency') return 'emergency';
  if (route === 'crisis') return 'crisis';
  if (route === 'plan') return 'plan';
  if (route === 'onboarding' || input.turnInput.profile.onboarding_completed === false) return 'onboarding';
  return null;
}

/** §8.4 Stage B: low; medium for crisis/ED/compensation/analysis/plan, ED tier ≥ amber, a protective trip. */
export function coachEffort(input: CoachInput): ReasoningEffort {
  const contract = coachContract(input);
  if (contract === 'emergency' || contract === 'crisis' || contract === 'ed_support' || contract === 'plan') return 'medium';
  if (input.tripwire.kind === 'protective' || input.tripwire.kind === 'fallback') return 'medium';
  const tier = edTierOf(input.turnInput);
  if (tier === 'amber' || tier === 'red' || tier === 'unknown') return 'medium';
  const route = isRec(input.decision.reply_route) ? input.decision.reply_route : null;
  if (route?.effort_hint === 'medium') return 'medium';
  const safety = isRec(input.decision.safety) ? input.decision.safety : null;
  const ed = safety && isRec(safety.ed_signal) ? safety.ed_signal : null;
  if (ed && typeof ed.category === 'string' && ed.category !== 'illness_vomiting') return 'medium';
  return 'low';
}

/** The contract text, placed after the user-state facts (§3.2 T6). Calm prose, its reason included. */
export const CONTRACT_TEXT: Record<Exclude<CoachContract, null>, string> = {
  emergency: [
    '## Bu turun sözleşmesi: acil durum',
    'Mesajda acil bir tıbbi durum işareti var ve dakikalar önemli. Koçluğu bırak, kısa ve net yaz: kişiyi hemen 112\'yi aramaya ya da en yakın acil servise gitmeye yönlendir, yanında biri varsa haber vermesini söyle. Kalori, kayıt ya da plan konuşma; bir soru soracaksan yalnızca şu anki güvenliğiyle ilgili olsun.',
  ].join('\n'),
  crisis: [
    '## Bu turun sözleşmesi: kriz',
    'Kişi kendine zarar verme ya da yaşamak istememe düşüncesi anlatıyor olabilir. Sıcak ve doğrudan ol: endişeni söyle, yalnız olmadığını hatırlat; güvende değilse 112\'yi aramasını ve güvendiği birine hemen ulaşmasını iste, bir psikolog ya da psikiyatristten destek almanın gerçekten yardımcı olacağını söyle. Yargılama, tavsiye listesi verme, kalori ve kayıt konuşma; bu turda tek soru soracaksan şu an güvende olup olmadığını sor.',
  ].join('\n'),
  ed_support: [
    '## Bu turun sözleşmesi: yeme bozukluğu desteği',
    'Mesajda yeme bozukluğu işareti var. Yargılamadan ve sıcak kal; kalori açığı, tartı ya da sayı odağı önerme, çünkü bunlar döngüyü besler. Bir uzmana (diyetisyen, psikolog) yönlendirmeyi kendi sesinle bir kez yap ve referral_included alanını işaretle. Bu turda bir kayıt yapıldıysa anlatmadan geç.',
  ].join('\n'),
  onboarding: [
    '## Bu turun sözleşmesi: tanışma',
    'Kişiyle yeni tanışıyorsun ve profilinde eksikler var (KULLANICI DURUMU, Tanışma satırı). Sorusu varsa önce onu yanıtla; uygun düşerse eksiklerden yalnızca birini sohbetin içinde sor, form doldurur gibi değil.',
  ].join('\n'),
  plan: [
    '## Bu turun sözleşmesi: plan',
    'Kişi plan konuşuyor. Taslağı ve sayılarını yalnızca BU TURDA OLANLAR ve KULLANICI DURUMU bloklarından anlat; bir taslak orada yazmıyorsa bu turda hazırlanmamıştır, hazırlanmış gibi anlatma. Plan kartı kişinin ekranında ayrıca görünür; günleri tek tek sayma.',
  ].join('\n'),
};

// ─── the request ───────────────────────────────────────────────────────────────────────────────────

function clip(text: string, max: number): string {
  const t = (text ?? '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** History → chat messages: machine blocks removed, each assistant turn with its receipts ⟦a · b⟧. */
export function renderHistory(history: CoachInput['history'], limit = COACH_HISTORY_MESSAGES): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const h of history.slice(-limit)) {
    if (h.role === 'user') {
      const content = clip(h.content, HISTORY_CHARS.user);
      if (content) out.push({ role: 'user', content });
    } else if (h.role === 'assistant') {
      const body = clip(stripMachineMarkers(h.content ?? ''), HISTORY_CHARS.assistant);
      const receipts = (h.receipts ?? []).filter((r) => typeof r === 'string' && r.trim() !== '');
      const content = receipts.length ? `${body}\n⟦${receipts.join(' · ')}⟧`.trim() : body;
      if (content) out.push({ role: 'assistant', content });
    }
  }
  return out;
}

/** The final user turn, in §3.2 T6 order. */
export function renderCoachUserTurn(facts: StageBFacts, contract: CoachContract, message: string): string {
  const blocks: string[] = [`${FACT_BLOCK_TITLES.state}\n${facts.state.join('\n')}`];
  if (facts.extra.length > 0) blocks.push(`${FACT_BLOCK_TITLES.extra}\n${facts.extra.join('\n')}`);
  if (contract) blocks.push(CONTRACT_TEXT[contract]);
  blocks.push(`${FACT_BLOCK_TITLES.turn}\n${facts.turn.join('\n')}`);
  if (facts.safety.length > 0) blocks.push(`${FACT_BLOCK_TITLES.safety}\n${facts.safety.join('\n')}`);
  blocks.push(`KULLANICI MESAJI\n${message}`);
  return blocks.join('\n\n');
}

/** The closing note of the ONE regeneration (§7.1): what to leave out, by name. */
export function renderRegenNote(note: RegenNote): string {
  const lines = ['DENETİM NOTU: önceki cevap taslağın kişinin güvenlik kısıtları denetiminden geçmedi.'];
  if (note.excluded.length) {
    lines.push(`Şunlar kısıtlarla çakışıyor: ${note.excluded.map((x) => `${x.name} (${x.why})`).join('; ')}.`);
    lines.push('Bunları ve benzerlerini önermeden cevabı yeniden yaz; önerdiğin her yiyeceği ve hareketi öneri listelerine etiketleriyle yaz.');
  }
  if (note.judgeFailed) {
    lines.push('Bağımsız denetim önceki taslağı doğrulayamadı. Kişinin alerjilerini ya da sakat bölgesini içerebilecek hiçbir yiyecek veya hareket önermeden, emin olduğun seçeneklerle yeniden yaz.');
  }
  lines.push('Geri kalan her şey aynı: olgular, ses ve tek soru kuralı.');
  return lines.join('\n');
}

export interface CoachOptions {
  /** The cache key is per user (§3.2 T6). */
  userId: string;
  model?: string;
  timeoutMs?: number;
  /** Override the registry capability list (tests); defaults to buildCapabilities(). */
  capabilities?: string;
  respond?: typeof respond;
  transport?: Transport;
  apiKey?: string;
  baseUrl?: string;
}

export interface CoachRequest {
  model: string;
  effort: ReasoningEffort;
  contract: CoachContract;
  messages: ChatMessage[];
  schema: StructuredSchema;
  cacheKey: string;
  maxTokens: number;
  timeoutMs: number;
  facts: StageBFacts;
}

/** Pure: the exact Stage B request for this turn (+ the regen note, when this is the ONE regen). */
export function buildCoachRequest(input: CoachInput, opts: CoachOptions, regen: RegenNote | null = null): CoachRequest {
  const contract = coachContract(input);
  const facts = buildStageBFacts(input);
  const protective = input.tripwire.kind === 'protective';
  const messages: ChatMessage[] = [
    { role: 'system', content: buildCoachPrefix({ capabilities: opts.capabilities ?? buildCapabilities() }) },
    ...renderHistory(input.history),
    { role: 'user', content: renderCoachUserTurn(facts, contract, input.message) },
  ];
  if (regen) messages.push({ role: 'system', content: renderRegenNote(regen) });
  return {
    model: opts.model ?? coachModel(),
    effort: coachEffort(input),
    contract,
    messages,
    schema: { name: SCHEMA_NAMES.reply, schema: buildReplySchema(), strict: true },
    cacheKey: coachCacheKey(opts.userId),
    maxTokens: COACH_MAX_OUTPUT_TOKENS,
    timeoutMs: opts.timeoutMs ?? (protective ? CRISIS_TIMEOUT_MS : COACH_TIMEOUT_MS),
    facts,
  };
}

// ─── the call ──────────────────────────────────────────────────────────────────────────────────────

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** The strict reply, defensively normalised (a json_object gateway is validated, not trusted). */
export function normalizeCoachReply(v: unknown): CoachReply | null {
  if (!isRec(v) || typeof v.reply !== 'string') return null;
  return {
    reply: v.reply,
    suggested_foods: (Array.isArray(v.suggested_foods) ? v.suggested_foods : []).filter(isRec)
      .map((f) => ({ name: String(f.name ?? '').trim(), allergens: strList(f.allergens), may_contain: strList(f.may_contain) }))
      .filter((f) => f.name !== ''),
    suggested_exercises: (Array.isArray(v.suggested_exercises) ? v.suggested_exercises : []).filter(isRec)
      .map((e) => ({ name: String(e.name ?? '').trim(), loads: strList(e.loads) }))
      .filter((e) => e.name !== ''),
    memory: Array.isArray(v.memory) ? v.memory : [],
    ui: isRec(v.ui) ? v.ui : { navigate_to: null, task_completion_summary: null },
    referral_included: v.referral_included === true,
    why: typeof v.why === 'string' && v.why.trim() !== '' ? v.why : null,
  };
}

/** Run Stage B once. Never throws: a transport exception is status 'error'. */
export async function runCoach(input: CoachInput, opts: CoachOptions, regen: RegenNote | null = null): Promise<CoachRun> {
  const req = buildCoachRequest(input, opts, regen);
  const call = opts.respond ?? respond;
  const started = Date.now();
  const base = { model: req.model, effort: req.effort, contract: req.contract, regen: regen !== null };
  try {
    const r = await call({
      model: req.model,
      effort: req.effort,
      input: req.messages,
      schema: req.schema,
      maxTokens: req.maxTokens,
      cacheKey: req.cacheKey,
      store: false,
      timeoutMs: req.timeoutMs,
      ...(opts.transport ? { transport: opts.transport } : {}),
      ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
      ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
    });
    const meta = { latencyMs: r.latencyMs, usage: r.usage, attempts: r.attempts, retries: r.retries };
    switch (r.kind) {
      case 'parsed': {
        const reply = normalizeCoachReply(r.value);
        return reply
          ? { ...base, ...meta, status: 'ok', reply, detail: null }
          : { ...base, ...meta, status: 'invalid', reply: null, detail: 'reply_not_normalisable' };
      }
      case 'refusal': return { ...base, ...meta, status: 'refused', reply: null, detail: r.refusal.slice(0, 300) };
      case 'invalid': return { ...base, ...meta, status: 'invalid', reply: null, detail: r.issues.slice(0, 5).join('; ') };
      case 'incomplete': return { ...base, ...meta, status: 'incomplete', reply: null, detail: r.reason };
      case 'function_call': return { ...base, ...meta, status: 'invalid', reply: null, detail: 'unexpected function_call' };
      case 'error': return { ...base, ...meta, status: r.error.class === 'timeout' ? 'timeout' : 'error', reply: null, detail: r.error.message.slice(0, 300) };
    }
  } catch (e) {
    return { ...base, status: 'error', reply: null, latencyMs: Date.now() - started, usage: null, attempts: 0, retries: [], detail: ((e as Error)?.message ?? String(e)).slice(0, 300) };
  }
}

/** runCoach bounded by `ms`, even if the transport ignores its timeout: late = status 'timeout'. */
export async function runCoachWithin(input: CoachInput, opts: CoachOptions, regen: RegenNote | null, ms: number): Promise<CoachRun> {
  const bounded = Math.max(1, Math.floor(ms));
  const timedOut = (): CoachRun => {
    const req = buildCoachRequest(input, opts, regen);
    return {
      status: 'timeout', reply: null, model: req.model, effort: req.effort, contract: req.contract, latencyMs: bounded,
      usage: null, attempts: 0, retries: [], detail: `turn budget: no answer within ${bounded}ms`, regen: regen !== null,
    };
  };
  return await withinBudget(runCoach(input, { ...opts, timeoutMs: Math.min(opts.timeoutMs ?? bounded, bounded) }, regen), bounded, timedOut);
}

/** The facts block alone (eval/shadow triage: what Stage B was told). */
export function coachFactsText(input: CoachInput): string {
  return renderStageBFacts(buildStageBFacts(input));
}
