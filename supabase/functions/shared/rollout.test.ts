import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { parseRolloutValue, rolloutEnvKey, rolloutMode, rolloutStamp } from './rollout.ts';

const U = '4750e6be-0000-0000-0000-000000000001';
const V = '4750e6be-0000-0000-0000-000000000002';

Deno.test('rolloutEnvKey upper-snakes the step id', () => {
  assertEquals(rolloutEnvKey('a1_ed_decay'), 'KOCHKO_ROLLOUT_A1_ED_DECAY');
  assertEquals(rolloutEnvKey('B1a turn-mode'), 'KOCHKO_ROLLOUT_B1A_TURN_MODE');
});

Deno.test('unset / empty falls back (default off)', () => {
  assertEquals(parseRolloutValue(undefined, U), 'off');
  assertEquals(parseRolloutValue(null, U), 'off');
  assertEquals(parseRolloutValue('   ', U), 'off');
  assertEquals(parseRolloutValue(undefined, U, 'on'), 'on');
});

Deno.test('word forms map to the three modes', () => {
  for (const w of ['off', '0', 'false', 'no']) assertEquals(parseRolloutValue(w, U), 'off');
  for (const w of ['on', '1', 'true', 'all', 'yes']) assertEquals(parseRolloutValue(w, U), 'on');
  assertEquals(parseRolloutValue('shadow', U), 'shadow');
  assertEquals(parseRolloutValue('  ON  ', U), 'on', 'case + whitespace tolerant');
});

Deno.test('bare allowlist enables only the listed users', () => {
  assertEquals(parseRolloutValue(`${U},${V}`, U), 'on');
  assertEquals(parseRolloutValue(`${U},${V}`, V), 'on');
  assertEquals(parseRolloutValue(`${U}`, V), 'off');
});

Deno.test('prefixed allowlist carries its mode', () => {
  assertEquals(parseRolloutValue(`shadow:${U}`, U), 'shadow');
  assertEquals(parseRolloutValue(`shadow:${U}`, V), 'off');
  assertEquals(parseRolloutValue(`on:${U}`, U), 'on');
});

Deno.test('an allowlist with no user resolves OFF, never on', () => {
  assertEquals(parseRolloutValue(`${U},${V}`, null), 'off');
  assertEquals(parseRolloutValue(`${U},${V}`, undefined), 'off');
});

Deno.test('a typo prefix fails CLOSED (never a surprise full rollout)', () => {
  // 'shdow:' is not a known prefix — must not be read as a bare allowlist that happens to
  // contain the user id, and must not enable anyone.
  assertEquals(parseRolloutValue(`shdow:${U}`, U), 'off');
  assertEquals(parseRolloutValue(`shdow:${U}`, U, 'on'), 'on', 'falls back, does not invent a mode');
});

Deno.test('rolloutMode reads the step key, then DEFAULT, then the fallback', () => {
  const step = 'test_step_x';
  Deno.env.delete(rolloutEnvKey(step));
  Deno.env.delete('KOCHKO_ROLLOUT_DEFAULT');
  assertEquals(rolloutMode(step, U), 'off');
  assertEquals(rolloutMode(step, U, 'shadow'), 'shadow');

  Deno.env.set('KOCHKO_ROLLOUT_DEFAULT', 'shadow');
  assertEquals(rolloutMode(step, U), 'shadow', 'DEFAULT applies when the step key is unset');

  Deno.env.set(rolloutEnvKey(step), 'on');
  assertEquals(rolloutMode(step, U), 'on', 'the step key outranks DEFAULT');

  Deno.env.delete(rolloutEnvKey(step));
  Deno.env.delete('KOCHKO_ROLLOUT_DEFAULT');
});

Deno.test('rolloutStamp lists only the non-off steps', () => {
  const a = 'stamp_a', b = 'stamp_b', c = 'stamp_c';
  Deno.env.set(rolloutEnvKey(a), 'shadow');
  Deno.env.set(rolloutEnvKey(b), 'on');
  Deno.env.set(rolloutEnvKey(c), 'off');
  assertEquals(rolloutStamp([a, b, c], U), 'stamp_a=shadow|stamp_b=on');
  assertEquals(rolloutStamp([c], U), '', 'an all-off turn costs zero bytes');
  for (const s of [a, b, c]) Deno.env.delete(rolloutEnvKey(s));
});
