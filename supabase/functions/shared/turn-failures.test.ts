import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { FAILURE_LINES, failureLine, guardVerdictOf, type GuardFlag, type TurnFailureClass } from './turn-failures.ts';

Deno.test('B5: a severe-allergen block can finally BE a verdict (it used to log as clean)', () => {
  assertEquals(guardVerdictOf(['allergen_blocked']), 'allergen_blocked');
  // The old derivation regexed the final reply. The block REPLACES that reply with a message that
  // contains none of the phrases it looked for, so the hardest safety event recorded as 'clean'.
  assertEquals(guardVerdictOf([]), 'clean', 'clean now means "nothing fired", not "unrecognised"');
});

Deno.test('worst-first collapse: the gravest flag wins', () => {
  assertEquals(guardVerdictOf(['allergen_warned', 'allergen_blocked']), 'allergen_blocked');
  assertEquals(guardVerdictOf(['injury_warned', 'ed_referral']), 'ed_referral');
  assertEquals(guardVerdictOf(['allergen_blocked', 'crisis']), 'crisis');
  assertEquals(guardVerdictOf(['emergency', 'crisis', 'allergen_blocked']), 'emergency');
  assertEquals(guardVerdictOf(['injury_warned']), 'injury_warned');
});

Deno.test('every failure class has a line, and only `unknown` may be generic', () => {
  const classes: TurnFailureClass[] = ['allergen_violation', 'injury_violation', 'generation_failed', 'persist_failed', 'quota', 'unknown'];
  for (const c of classes) {
    const line = failureLine(c);
    assert(line.length > 20, `${c} needs a real sentence`);
    assert(!/bir sorun oldu/i.test(line) || c === 'unknown', `${c} must not fall back to the generic apology`);
  }
});

Deno.test('the two refusal classes tell the user retrying will NOT help', () => {
  // This is the whole point: an allergen violation is not a transient failure. The old copy sent
  // the user into an endless retry loop for something a retry can never fix.
  assert(/tekrar denemek bunu çözmez/i.test(FAILURE_LINES.allergen_violation));
  assert(/alerjensiz hazırla/i.test(FAILURE_LINES.allergen_violation), 'and names the way out');
  assert(/sakatlık dostu hazırla/i.test(FAILURE_LINES.injury_violation));
});

Deno.test('the retryable classes DO invite a retry', () => {
  for (const c of ['generation_failed', 'persist_failed'] as TurnFailureClass[]) {
    assert(/dene/i.test(FAILURE_LINES[c]), `${c} should invite a retry`);
  }
});

Deno.test('unknown flags cannot invent a verdict', () => {
  assertEquals(guardVerdictOf(['not_a_flag' as unknown as GuardFlag]), 'clean');
});
