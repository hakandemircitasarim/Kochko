/**
 * openai.test.ts — the GPT-5.6 transport seam.
 *
 * Every failure guarded here is a 400 or an empty reply on EVERY call, not a degradation:
 * sending `temperature` to a reasoning model, mistranslating a vision part, reading
 * `choices[0]` off a /responses body, or letting thinking eat the whole output budget.
 */
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  usesResponsesApi,
  resolveOutputBudget,
  toResponsesMessage,
  extractResponsesText,
  EFFORT,
  TEMPERATURE,
  buildVisionContent,
} from './openai.ts';

Deno.test('reasoning models route to /responses, legacy models do not', () => {
  for (const m of ['gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6-sol', 'GPT-5.6-Terra', 'o3', 'o4-mini']) {
    assert(usesResponsesApi(m), `${m} must use /responses`);
  }
  for (const m of ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'claude-3', 'llama-3']) {
    assert(!usesResponsesApi(m), `${m} must stay on /chat/completions`);
  }
});

Deno.test('the gpt-4o rollback path is preserved (secret-only, no redeploy)', () => {
  // If this ever flips, an incident recovery turns from a 10-second secret-set into a redeploy.
  assert(!usesResponsesApi('gpt-4o'));
});

Deno.test('thinking cannot consume the whole output budget', () => {
  // none = classic instruct behaviour, budget untouched.
  assertEquals(resolveOutputBudget(2000, 'none'), 2000);
  assertEquals(resolveOutputBudget(2000, undefined), 2000);
  // Any real effort must leave room for visible text ON TOP of the caller's ask.
  for (const effort of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
    const budget = resolveOutputBudget(2000, effort);
    assert(budget > 2000, `${effort} must reserve headroom, got ${budget}`);
  }
  // Deeper thinking never reserves less than shallower thinking.
  const ladder = (['low', 'medium', 'high', 'xhigh', 'max'] as const).map((e) => resolveOutputBudget(2000, e));
  for (let i = 1; i < ladder.length; i++) assert(ladder[i] >= ladder[i - 1], 'reserve ladder must be monotonic');
  // A caller asking for a lot still gets at least what it asked for, plus room to think.
  assert(resolveOutputBudget(16_000, 'medium') > 16_000);
});

Deno.test('string content passes through untouched (least-fragile form)', () => {
  const out = toResponsesMessage({ role: 'user', content: 'merhaba' });
  assertEquals(out, { role: 'user', content: 'merhaba' });
});

Deno.test('vision parts are translated to the /responses vocabulary', () => {
  // buildVisionContent emits Chat-Completions shape; the transport translates it. A miss here is
  // a 400 on the photo-meal flow, which is one of the app's headline features.
  const content = buildVisionContent('Bu fotodaki yemekleri analiz et.', 'BASE64DATA');
  const out = toResponsesMessage({ role: 'user', content });
  const parts = out.content as Array<Record<string, unknown>>;

  assertEquals(parts[0].type, 'input_text');
  assertEquals(parts[0].text, 'Bu fotodaki yemekleri analiz et.');

  assertEquals(parts[1].type, 'input_image');
  assertEquals(parts[1].detail, 'high');
  assert(String(parts[1].image_url).startsWith('data:image/jpeg;base64,'));
  // The nested {url} object must be FLATTENED — /responses rejects the chat-completions form.
  assert(typeof parts[1].image_url === 'string', 'image_url must be a flat string');
});

Deno.test('assistant text is extracted from the output array, not choices[0]', () => {
  const body = {
    status: 'completed',
    output: [
      { type: 'reasoning', summary: ['private thinking that must never surface'] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Bugün 1800 kcal.' }] },
    ],
  };
  assertEquals(extractResponsesText(body), 'Bugün 1800 kcal.');
});

Deno.test('reasoning items never leak into the answer', () => {
  const body = {
    output: [{ type: 'reasoning', summary: ['SECRET'], content: [{ type: 'output_text', text: 'SECRET' }] }],
  };
  assertEquals(extractResponsesText(body), '');
});

Deno.test('multi-part answers are concatenated in order', () => {
  const body = {
    output: [{
      type: 'message',
      content: [{ type: 'output_text', text: 'bir ' }, { type: 'output_text', text: 'iki' }],
    }],
  };
  assertEquals(extractResponsesText(body), 'bir iki');
});

Deno.test('the output_text fast path is used when present but never trusted when blank', () => {
  assertEquals(extractResponsesText({ output_text: 'hizli yol' }), 'hizli yol');
  // Blank aggregate must fall through to the array walk rather than returning ''.
  const body = {
    output_text: '   ',
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'gercek cevap' }] }],
  };
  assertEquals(extractResponsesText(body), 'gercek cevap');
});

Deno.test('an empty/degenerate body yields empty string, never a throw', () => {
  assertEquals(extractResponsesText({}), '');
  assertEquals(extractResponsesText({ output: [] }), '');
  assertEquals(extractResponsesText({ output: 'not-an-array' }), '');
});

Deno.test('EFFORT and TEMPERATURE cover the same task modes', () => {
  // The two dials are the per-transport twins of each other. A mode present in one but not the
  // other silently falls back to a default on exactly the turns that mode existed to tune.
  const tempKeys = Object.keys(TEMPERATURE).sort();
  const effortKeys = Object.keys(EFFORT).sort();
  assertEquals(effortKeys, tempKeys);
});

Deno.test('turns that commit a number the user acts on get real thinking', () => {
  // Plans and analysis produce calories/macros/targets. These must never run at `none`.
  for (const mode of ['plan', 'plan_diet', 'plan_workout', 'analyst', 'simulation', 'plateau', 'recovery']) {
    assertEquals(EFFORT[mode], 'medium', `${mode} must reason before committing numbers`);
  }
  // Pure parsing is schema-constrained; thinking buys nothing and costs seconds.
  assertEquals(EFFORT.register, 'none');
  // Chat is latency-sensitive.
  assertEquals(EFFORT.coaching, 'low');
});
