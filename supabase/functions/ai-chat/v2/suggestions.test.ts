/**
 * suggestions.test.ts — the handler-owned T7 suggestion invariant (§7.1). Pinned: the sets come from
 * the spine + this turn's own protective declarations; a clean reply passes untouched; a violation
 * gets exactly ONE regen that names the excluded items, inside the remaining Stage B budget; a regen
 * that still violates / fails / is out of budget is a fallback; an unreadable spine never lets a
 * suggestion out; the fallback wording never repeats back to back.
 */
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { validateDecision } from '../../shared/write-registry/mod.ts';
import { sampleDecision } from '../../shared/write-registry/samples.ts';
import type { CoachInput, CoachReply } from './contracts.ts';
import { turnRefs, validationContext } from './input.ts';
import {
  enforceSuggestionInvariant, regenFactLine, SUGGESTION_FALLBACK_LINES, suggestionFallbackLine, suggestionSafetyOf, suggestionViolations, type SuggestionSafety,
} from './suggestions.ts';
import { NOW } from './testing.ts';
import { coachReply, seededTurnInput } from './turn-testing.ts';

const SAFETY: SuggestionSafety = { severeAllergens: ['fıstık'], injuredRegions: ['knee'], unknown: false };
const peanutToast = coachReply('Fıstık ezmeli tost iyi gider.', { suggested_foods: [{ name: 'fıstık ezmeli tost', allergens: ['peanut'], may_contain: [] }] });
const squats = coachReply('Bugün squat yapalım.', { suggested_exercises: [{ name: 'squat', loads: ['knee', 'hip'] }] });
const clean = coachReply('Yoğurtlu meyve iyi gider.', { suggested_foods: [{ name: 'yoğurtlu meyve', allergens: ['milk'], may_contain: [] }] });
const input = { userState: ['ŞİMDİ: Çarşamba'] } as unknown as CoachInput;

function gate(reply: CoachReply | null, regen: (i: CoachInput, ms: number) => Promise<CoachReply | null>, over: { safety?: SuggestionSafety; remaining?: number } = {}) {
  const calls: Array<{ input: CoachInput; ms: number }> = [];
  const p = enforceSuggestionInvariant({
    reply, input, safety: over.safety ?? SAFETY, remainingMs: () => over.remaining ?? 15_000,
    regen: (i, ms) => { calls.push({ input: i, ms }); return regen(i, ms); },
  });
  return { p, calls };
}

Deno.test('suggestionSafetyOf: spine (severe allergen, injured region) + the user’s own declaration THIS turn', async () => {
  const ti = await seededTurnInput();
  const s0 = suggestionSafetyOf(ti, null);
  assertEquals(s0.severeAllergens, ['fıstık']);
  assertEquals(s0.injuredRegions, ['knee']);
  assertEquals(s0.unknown, false);
  const msg = 'susam alerjim var, akşam ne yiyeyim?';
  const refs = turnRefs(ti);
  const v = validateDecision(sampleDecision({
    writes: [{ op: 'constraint_add', kind: 'allergen', subject_id: 'sesame', display_tr: 'susam', whose: 'self', polarity: 'has', severity: 'unknown', body_parts: [], event_date: null, note: null, evidence_quote: 'susam alerjim var' }],
  }), validationContext(ti, msg, NOW, refs));
  const s1 = suggestionSafetyOf(ti, v);
  assert(s1.severeAllergens.includes('sesame') && s1.severeAllergens.includes('susam'), 'declared this turn → protected in this very reply');
  const broken = await seededTurnInput();
  broken.load_errors.push({ section: 'constraints', message: 'timeout' });
  assertEquals(suggestionSafetyOf(broken, null).unknown, true);
});

Deno.test('a reply without suggestions, or with clean ones, passes untouched (no regen)', async () => {
  for (const r of [coachReply('Merhaba!'), clean, null]) {
    const g = gate(r, () => Promise.resolve(coachReply('x')));
    const out = await g.p;
    assertEquals(out.kind, 'pass');
    if (out.kind === 'pass') assertEquals(out.reply, r);
    assertEquals(g.calls.length, 0);
  }
  assertEquals(suggestionViolations(clean, SAFETY), []);
});

Deno.test('a violating suggestion → ONE regen naming the excluded items, within the remaining budget; a clean regen is used', async () => {
  const g = gate(peanutToast, () => Promise.resolve(clean), { remaining: 9_000 });
  const out = await g.p;
  assertEquals(out.kind, 'pass');
  if (out.kind === 'pass') assertEquals(out.reply, clean);
  assertEquals(g.calls.length, 1);
  assertEquals(g.calls[0].ms, 9_000, 'the regen gets what is left of the ONE Stage B deadline');
  const extra = g.calls[0].input.userState.at(-1)!;
  assertStringIncludes(extra, 'ÖNERİ DENETİMİ');
  assertStringIncludes(extra, 'fıstık ezmeli tost (fıstık)');
  assertEquals(g.calls[0].input.userState[0], 'ŞİMDİ: Çarşamba', 'the other facts are kept');
  assertEquals(out.issues, ['suggestion_violation:1', 'suggestion_regen']);
});

Deno.test('an injured-region load is a violation too; a regen that still violates → fallback (no second regen)', async () => {
  const g = gate(squats, () => Promise.resolve(squats));
  const out = await g.p;
  assertEquals(out.kind, 'fallback');
  if (out.kind === 'fallback') assertEquals(out.reason, 'violation');
  assertEquals(g.calls.length, 1);
  assertStringIncludes(regenFactLine(suggestionViolations(squats, SAFETY)), 'squat (knee)');
});

Deno.test('a failed / empty regen and an exhausted budget are fallbacks, never the violating reply', async () => {
  const thrown = await gate(peanutToast, () => Promise.reject(new Error('timeout'))).p;
  assertEquals(thrown.kind, 'fallback');
  const empty = await gate(peanutToast, () => Promise.resolve(coachReply('  '))).p;
  assertEquals(empty.kind, 'fallback');
  const late = gate(peanutToast, () => Promise.resolve(clean), { remaining: 300 });
  const out = await late.p;
  assertEquals(out.kind, 'fallback');
  assertEquals(late.calls.length, 0, 'no regen without budget');
  assert(out.issues.includes('suggestion_regen_skipped'));
});

Deno.test('an unreadable spine: a reply WITH suggestions never goes out (fail-closed, honest wording); one without passes', async () => {
  const unknown = { ...SAFETY, unknown: true };
  const g = gate(clean, () => Promise.resolve(clean), { safety: unknown });
  const out = await g.p;
  assertEquals(out.kind, 'fallback');
  if (out.kind === 'fallback') assertEquals(out.reason, 'unverified');
  assertEquals(g.calls.length, 0, 'a regen could not be verified either');
  assertEquals((await gate(coachReply('Merhaba!'), () => Promise.resolve(clean), { safety: unknown }).p).kind, 'pass');
});

Deno.test('the safe fallback never repeats the same wording back to back', () => {
  assertEquals(suggestionFallbackLine(null), SUGGESTION_FALLBACK_LINES[0]);
  assertEquals(suggestionFallbackLine(`Öğün kaydedildi\n${SUGGESTION_FALLBACK_LINES[0]}`), SUGGESTION_FALLBACK_LINES[1]);
  assertEquals(suggestionFallbackLine(SUGGESTION_FALLBACK_LINES[1]), SUGGESTION_FALLBACK_LINES[0]);
});
