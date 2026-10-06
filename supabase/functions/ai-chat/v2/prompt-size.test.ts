import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { estimateTokens, PROMPT_BUDGETS, TR_CHARS_PER_TOKEN } from './prompt-size.ts';

Deno.test('estimateTokens: conservative chars-per-token ratio, rounds up', () => {
  assertEquals(estimateTokens(''), 0);
  assertEquals(estimateTokens('a'), 1);
  assertEquals(estimateTokens('x'.repeat(320)), Math.ceil(320 / TR_CHARS_PER_TOKEN));
  // Over-counting is the safe side for a ceiling test: Turkish runs ~3.3–4 chars/token in practice.
  assert(TR_CHARS_PER_TOKEN <= 3.5);
});

Deno.test('budgets: every [floor, ceiling] is a real range around the §8 targets', () => {
  for (const [name, [floor, ceil]] of Object.entries(PROMPT_BUDGETS)) {
    assert(floor > 0 && floor < ceil, `${name}: bad range`);
  }
  // §8.2: constitution ~3–3.5K; §8.3: rules ~1.2K.
  assert(PROMPT_BUDGETS.constitution[0] <= 3000 && PROMPT_BUDGETS.constitution[1] >= 3500);
  assert(PROMPT_BUDGETS.understandRules[0] <= 1200 && PROMPT_BUDGETS.understandRules[1] >= 1200);
});
