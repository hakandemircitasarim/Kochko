/**
 * ai-chat/v2/client-parsers.test.ts — the CLIENT'S OWN PARSERS, copied verbatim (no Deno.test here).
 *
 * Shared by envelope.test.ts (which asserts every copied source line still exists in
 * ChatThreadScreen.tsx / chat.service.ts — the drift guard) and handler.test.ts (the end-to-end
 * envelope snapshot). The copies are regexes, so the file carries the .test.ts suffix: arch-guard G13
 * (no regex in ai-chat/v2 runtime code) exempts tests. Also v1's responseData key order, read from
 * index.ts, which every v2 envelope must keep.
 */
import type { TurnEnvelope } from '../../shared/contracts/turn-envelope.ts';

const root = new URL('../../../../', import.meta.url);
export const CLIENT = Deno.readTextFileSync(new URL('src/screens/ChatThreadScreen.tsx', root));
export const CHAT_SERVICE = Deno.readTextFileSync(new URL('src/services/chat.service.ts', root));
export const V1 = Deno.readTextFileSync(new URL('supabase/functions/ai-chat/index.ts', root));

export const CLIENT_LINES = [
  "const match = content.match(/<simulation>([\\s\\S]*?)<\\/simulation>/);",
  "const cleanContent = content.replace(/<simulation>[\\s\\S]*?<\\/simulation>/, '').trim();",
  "const match = content.match(/<reasoning>([\\s\\S]*?)<\\/reasoning>/);",
  "const cleanContent = content.replace(/<reasoning>[\\s\\S]*?<\\/reasoning>/, '').trim();",
  "return !!content.match(/<confirm_reject\\s*\\/?>/) || taskMode === 'plan_suggestion';",
  ".replace(/<confirm_reject\\s*\\/?>/g, '')",
];

export function parseSimulationData(content: string): { cleanContent: string; data: Record<string, unknown> | null } {
  const match = content.match(/<simulation>([\s\S]*?)<\/simulation>/);
  if (!match) return { cleanContent: content, data: null };
  try {
    const data = JSON.parse(match[1]);
    const cleanContent = content.replace(/<simulation>[\s\S]*?<\/simulation>/, '').trim();
    return { cleanContent, data };
  } catch {
    return { cleanContent: content, data: null };
  }
}
export function parseReasoning(content: string): { cleanContent: string; reasoning: string | null } {
  const match = content.match(/<reasoning>([\s\S]*?)<\/reasoning>/);
  if (!match) return { cleanContent: content, reasoning: null };
  const reasoning = match[1].trim();
  const cleanContent = content.replace(/<reasoning>[\s\S]*?<\/reasoning>/, '').trim();
  return { cleanContent, reasoning: reasoning || null };
}
export function hasConfirmRejectIndicator(content: string, taskMode?: string): boolean {
  return !!content.match(/<confirm_reject\s*\/?>/) || taskMode === 'plan_suggestion';
}
export function clientStripMachineMarkers(text: string): string {
  return text.replace(/<confirm_reject\s*\/?>/g, '').trim();
}

/** ChatThreadScreen's live path (≈1371-1404): what the user sees, the card, the "Neden?" text, the buttons. */
export function clientLive(env: TurnEnvelope) {
  let messageContent = env.message;
  let simulationData = env.simulation ?? null;
  const sim = parseSimulationData(messageContent);
  messageContent = sim.cleanContent;
  if (!simulationData) simulationData = sim.data as typeof simulationData;
  const r = parseReasoning(messageContent);
  messageContent = r.cleanContent;
  const hasPlanSuggestion = hasConfirmRejectIndicator(messageContent, env.task_mode);
  messageContent = clientStripMachineMarkers(messageContent);
  return { visible: messageContent, reasoning: r.reasoning, simulationData, hasPlanSuggestion };
}

/** The history-reload path (toUIMessage + parseSimulationData fallback): the stored text alone. */
export function clientReload(stored: string, taskMode: string) {
  let content = stored;
  const r = content.includes('<reasoning>') ? parseReasoning(content) : { cleanContent: content, reasoning: null };
  content = r.cleanContent;
  const hasPlan = hasConfirmRejectIndicator(content, taskMode);
  content = clientStripMachineMarkers(content);
  const sim = parseSimulationData(content);
  return { visible: sim.cleanContent, reasoning: r.reasoning, simulation: sim.data, hasPlan };
}

/** v1's responseData key order (read from index.ts): the envelope must keep it. */
export const V1_KEYS = (() => {
  const s = V1.indexOf('const responseData = {');
  const e = V1.indexOf('\n    };', s);
  // `key: value` and shorthand `key,` (v1 writes `simulation,`).
  return [...V1.slice(s, e).matchAll(/^\s{6}([a-z_]+)(?::|,$)/gm)].map((m) => m[1]);
})();

