import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { detectEDRisk } from './guardrails.ts';

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
