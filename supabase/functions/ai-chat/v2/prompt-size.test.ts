import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { estimateTokens, PROMPT_BUDGETS, TR_CHARS_PER_TOKEN } from './prompt-size.ts';
import * as registryTokens from '../../shared/write-registry/tokens.ts';
import { STAGE_A_REGISTRY_BUDGET } from '../../shared/write-registry/budget.ts';

Deno.test('estimateTokens: the registry\'s one conservative chars-per-token ratio, rounds up', () => {
  assertEquals(estimateTokens(''), 0);
  assertEquals(estimateTokens('a'), 1);
  assertEquals(estimateTokens('x'.repeat(320)), Math.ceil(320 / TR_CHARS_PER_TOKEN));
  // Over-counting is the safe side for a ceiling test: Turkish prose runs ~3.4–3.5 chars/token, compact JSON ~4.4 (tokens.ts).
  assert(TR_CHARS_PER_TOKEN <= 3.5);
  // Not a second estimator: the same constant and function as the registry budget.
  assertEquals(TR_CHARS_PER_TOKEN, registryTokens.TR_CHARS_PER_TOKEN);
  assertEquals(estimateTokens, registryTokens.estimateTokens);
});

Deno.test('budgets: every [floor, ceiling] is a real range around the §3.3/§8 targets', () => {
  for (const [name, [floor, ceil]] of Object.entries(PROMPT_BUDGETS)) {
    assert(floor > 0 && floor < ceil, `${name}: bad range`);
  }
  // §8.2: constitution ~3–3.5K; §8.3: rules ~1.3K.
  assert(PROMPT_BUDGETS.constitution[0] <= 3000 && PROMPT_BUDGETS.constitution[1] >= 3500);
  assert(PROMPT_BUDGETS.understandRules[0] <= 1300 && PROMPT_BUDGETS.understandRules[1] >= 1300);
  // The whole Stage A prefix holds the brain's rules + few-shots and the registry's doc + schema:
  // its ceiling is never looser than the parts' ceilings combined (it is the tighter, binding one).
  const parts = PROMPT_BUDGETS.understandRules[1] + PROMPT_BUDGETS.understandFewShots[1] + STAGE_A_REGISTRY_BUDGET.total.ceiling;
  assert(PROMPT_BUDGETS.stageAPrefix[1] <= parts, `stageAPrefix ceiling ${PROMPT_BUDGETS.stageAPrefix[1]} > sum of part ceilings ${parts}`);
});
