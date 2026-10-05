import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { detectEDRisk } from './guardrails.ts';
import { deficitAllowed, getSafetyState } from './safety-state.ts';

/**
 * Faz 0 #6 — the deficit gate fails CLOSED. Unit tests run without net permission, so the
 * user_safety_state query fails — and supabase-js reports that in `error`, it does not throw: the
 * exact outage the gate used to read as "no row" = tier 'none' = deficit allowed. (Skipped if the
 * suite is ever run with net access, where a real read could legitimately say "allowed".)
 */
const NET_GRANTED = Deno.permissions.querySync?.({ name: 'net' }).state === 'granted';

Deno.test({
  name: 'Faz 0 #6: deficitAllowed refuses a deficit on an unreadable state; prompt framing stays fail-open',
  ignore: NET_GRANTED,
  fn: async () => {
    const uid = '00000000-0000-0000-0000-000000000000';
    // Concurrently: each failed read waits out the client's own retries.
    const [gate, framing] = await Promise.all([deficitAllowed(uid), getSafetyState(uid)]);
    assertEquals([gate.allowed, gate.unreadable], [false, true]);
    assert(gate.reason?.startsWith('safety_state_unreadable'));
    assertEquals(framing.ed_tier, 'none'); // §7.1: the prompt frame keeps today's open default
  },
});

/**
 * F2 · A8 — false-positive suppression for the ED detector.
 *
 * Why this matters more after A1: the de-escalation fix means a tier now costs a REAL 14 days per
 * step. Every false flag therefore locks a deficit-averse, number-shy coach onto someone who never
 * had a risk signal — and the user can neither see that state nor clear it.
 */

Deno.test('A8: refusing the risky thing is not the risky thing', () => {
  const negatives = [
    'kusmak istemiyorum, bu yüzden yardım istiyorum',
    'laksatif kullanmam gerekir mi diye merak ettim, kullanmıyorum',
    'müshil kullanmıyorum hiç',
    'aç kalmak istemiyorum, doyurucu bir plan olsun',
  ];
  for (const m of negatives) {
    assertEquals(detectEDRisk(m).isRisk, false, m);
  }
});

Deno.test('A8: a real signal still fires, including when a wish follows it', () => {
  assertEquals(detectEDRisk('dün akşam yine kustum').severity, 'high');
  assertEquals(detectEDRisk('kustum ama bir daha istemiyorum').severity, 'high',
    'a genuine report followed by a wish is still a report');
  assertEquals(detectEDRisk('laksatif kullanıyorum').severity, 'high');
});

Deno.test('A8: reporting what you ATE is a log, not a dangerous target', () => {
  for (const m of ['bugün 450 kalori yedim', 'öğlen 600 kalori aldım', 'sabah 300 kcal tükettim']) {
    assertEquals(detectEDRisk(m).isRisk, false, m);
  }
});

Deno.test('A8: INTENDING to eat that little still fires', () => {
  for (const m of ['günde 500 kalori yemek istiyorum', 'hedefim günde 600 kalori', 'yarından itibaren 700 kalori yiyeceğim']) {
    assertEquals(detectEDRisk(m).severity, 'medium', m);
  }
});

Deno.test('A8: a calorie DEFICIT is still not intake (pre-existing rule preserved)', () => {
  assertEquals(detectEDRisk('günde 500 kalori açık yapıyorum').isRisk, false);
});

Deno.test('A8: rapid-loss intent is untouched by the new guards', () => {
  assert(detectEDRisk('bir an önce zayıflamak istiyorum').isRisk);
});
