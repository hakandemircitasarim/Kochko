import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  ACTIVE_ROLLOUT_STEPS, parseRolloutValue, rolloutBucket, rolloutEnvKey, rolloutMode, rolloutStamp, V2_ROLLOUT_STEPS,
} from './rollout.ts';

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

// ─── AI_MIMARI_V2 §10: deterministic pct bucket + v2 steps ──────────────────────────────────────

/** n synthetic, uuid-shaped user ids (deterministic). */
function fakeUsers(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(`0000${i.toString(16).padStart(4, '0')}-1111-4222-8333-${(i * 7919).toString(16).padStart(12, '0')}`);
  }
  return out;
}

async function webCryptoBucket(step: string, uid: string): Promise<number> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${step}${uid}`));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return Number(BigInt(`0x${hex}`) % 100n);
}

Deno.test('rolloutBucket is sha256(step + uid) mod 100 — pinned to WebCrypto', async () => {
  for (const uid of [U, V, ...fakeUsers(20)]) {
    for (const step of ['v2_understand_shadow', 'v2_turn']) {
      assertEquals(rolloutBucket(step, uid), await webCryptoBucket(step, uid), `${step}/${uid}`);
    }
  }
});

Deno.test('rolloutBucket normalises case/whitespace and is salted by the step', () => {
  assertEquals(rolloutBucket(' V2_Turn ', ` ${U.toUpperCase()} `), rolloutBucket('v2_turn', U));
  const users = fakeUsers(50);
  assertEquals(users.some((u) => rolloutBucket('v2_turn', u) !== rolloutBucket('v2_plan', u)), true, 'each step draws its own cohort');
  for (const u of users) {
    const b = rolloutBucket('v2_turn', u);
    assertEquals(Number.isInteger(b) && b >= 0 && b < 100, true);
  }
});

Deno.test('pct=N selects ~N% of users, deterministically, and raising N only adds users', () => {
  const users = fakeUsers(2000);
  const on = (raw: string) => users.filter((u) => parseRolloutValue(raw, u, 'off', 'v2_turn') === 'on');
  const p5 = on('pct=5'), p20 = on('pct=20'), p50 = on('pct=50');
  for (const [got, want] of [[p5.length, 100], [p20.length, 400], [p50.length, 1000]] as const) {
    // binomial sd at n=2000 is ≤ 23 users; ±70 is a 3σ band on a FIXED sample, so it never flakes.
    assertEquals(Math.abs(got - want) <= 70, true, `expected ~${want}, got ${got}`);
  }
  const s20 = new Set(p20);
  assertEquals(p5.every((u) => s20.has(u)), true, 'pct=5 ⊂ pct=20');
  assertEquals(on('pct=20').join(), p20.join(), 'same answer every time');
});

Deno.test('pct edges: 0 nobody, 100 everybody with a user, no user → off', () => {
  const users = fakeUsers(200);
  assertEquals(users.some((u) => parseRolloutValue('pct=0', u, 'off', 's') !== 'off'), false);
  assertEquals(users.every((u) => parseRolloutValue('pct=100', u, 'off', 's') === 'on'), true);
  assertEquals(parseRolloutValue('pct=100', null, 'off', 's'), 'off');
  assertEquals(parseRolloutValue('pct=100', undefined, 'on', 's'), 'off', 'a bucket needs a user');
});

Deno.test('pct combines with an allowlist and with the shadow prefix', () => {
  const users = fakeUsers(400);
  const outside = users.find((u) => rolloutBucket('v2_turn', u) >= 5)!;
  const inside = users.find((u) => rolloutBucket('v2_turn', u) < 5)!;
  assertEquals(parseRolloutValue(`pct=5,${outside}`, outside, 'off', 'v2_turn'), 'on', 'listed user is on regardless of bucket');
  assertEquals(parseRolloutValue(`pct=5,${outside}`, inside, 'off', 'v2_turn'), 'on', 'bucket user is on');
  assertEquals(parseRolloutValue(`pct=5,${U}`, outside, 'off', 'v2_turn'), 'off');
  assertEquals(parseRolloutValue('shadow:pct=5', inside, 'off', 'v2_turn'), 'shadow');
  assertEquals(parseRolloutValue('shadow:pct=5', outside, 'off', 'v2_turn'), 'off');
  assertEquals(parseRolloutValue(`on: PCT = 5 , ${outside}`, inside, 'off', 'v2_turn'), 'on', 'spacing/case tolerant');
});

Deno.test('a malformed pct fails CLOSED to the fallback (never a guessed cohort)', () => {
  for (const raw of ['pct=abc', 'pct=12.5', 'pct=150', 'pct=-1', 'pct=', 'pct=5,pct=10', 'pctx=5', `pct=5x,${U}`]) {
    assertEquals(parseRolloutValue(raw, U, 'off', 'v2_turn'), 'off', raw);
    assertEquals(parseRolloutValue(raw, U, 'shadow', 'v2_turn'), 'shadow', `${raw}: falls back, does not invent a mode`);
  }
});

Deno.test('v2 steps are default OFF, stamped by the ledger, and deaf to KOCHKO_ROLLOUT_DEFAULT', () => {
  assertEquals([...V2_ROLLOUT_STEPS], ['v2_understand_shadow', 'v2_turn', 'v2_plan', 'v2_classifier', 'v2_stream']);
  for (const s of V2_ROLLOUT_STEPS) assertEquals(ACTIVE_ROLLOUT_STEPS.includes(s), true, s);
  for (const s of V2_ROLLOUT_STEPS) Deno.env.delete(rolloutEnvKey(s));
  Deno.env.set('KOCHKO_ROLLOUT_DEFAULT', 'on');
  try {
    for (const s of V2_ROLLOUT_STEPS) assertEquals(rolloutMode(s, U), 'off', `${s} must not follow DEFAULT=on`);
    assertEquals(rolloutMode('b1a_return_flow', U), 'on', 'older steps still follow DEFAULT');
    Deno.env.set(rolloutEnvKey('v2_understand_shadow'), `on:${U}`);
    assertEquals(rolloutMode('v2_understand_shadow', U), 'on', 'its own key still works');
    assertEquals(rolloutMode('v2_understand_shadow', V), 'off');
    Deno.env.set(rolloutEnvKey('v2_understand_shadow'), 'pct=100');
    assertEquals(rolloutMode('v2_understand_shadow', V), 'on', 'rolloutMode hands the step to the bucket');
    assertEquals(rolloutStamp(['v2_understand_shadow', 'v2_turn'], V), 'v2_understand_shadow=on');
  } finally {
    Deno.env.delete('KOCHKO_ROLLOUT_DEFAULT');
    Deno.env.delete(rolloutEnvKey('v2_understand_shadow'));
  }
});
