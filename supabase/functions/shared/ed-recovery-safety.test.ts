import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { sanitizeText } from './guardrails.ts';
import { tdeeRecalcCardText } from './target-engine.ts';
import { recoveryWeekLines } from './service-contexts.ts';

// ─────────────────────────────────────────────────────────────────────────────
// sanitizeText — model OUTPUT is never an ED risk signal (final2#9 / mem#12)
// ─────────────────────────────────────────────────────────────────────────────
Deno.test('final2#9: the coach\'s protective "aç kalma" advice gets no ED referral appended', () => {
  const reply = 'Bir günlük fazlalık haftayı bozmaz; bugün bunun yüzünden telafi için aç kalma, yarın normal düzenine dön.';
  assertEquals(sanitizeText(reply).clean, reply);
});

Deno.test('mem#12: an ED word inside a hidden control block or an explanation appends nothing', () => {
  const reply = 'Levotiroksini sabah aç karnına al.\n\n<layer2_update>{"coaching_note":"kusma öyküsü sorulmadı; binge döngüsü yok"}</layer2_update>';
  assertEquals(sanitizeText(reply).clean, reply);
});

Deno.test('mem#12: a model-written referral is not followed by a canned ASCII siz-voice duplicate', () => {
  const reply = 'Bu konuda profesyonel destek alman çok önemli. Bir uzman diyetisyen veya psikologla görüşmeni öneririm.';
  const out = sanitizeText(reply).clean;
  assertEquals(out, reply);
  assert(!/almanizi|Dernegi|gorusmeniz/.test(out));
});

// AI_MIMARI_V2 Faz 0 #4: the medical-claim guard is a LOG-ONLY tripwire — it still detects and
// names the rule, but never cuts words out of the reply or appends its canned note.
Deno.test('sanitizeText: the medical-claim guard detects the role claim but leaves the reply untouched', () => {
  const reply = 'Doktor olarak söylüyorum, bu normal.';
  const r = sanitizeText(reply);
  assert(r.hadViolations);
  assert(r.violatedRuleIds.includes('role_doctor'));
  assertEquals(r.clean, reply);
  assert(!r.clean.includes('doktoruna danışmalısın'));
});

// ─────────────────────────────────────────────────────────────────────────────
// tdeeRecalcCardText — announce only what was stored (mem#5)
// ─────────────────────────────────────────────────────────────────────────────
const card = { tdee: 2130, proteinG: 144, waterL: 2.6, currentWeight: 80, lastWeight: 80 };

Deno.test('mem#5: a band the ED gate refused produces NO card (no lower range announced)', () => {
  assertEquals(tdeeRecalcCardText({ ...card, trigger: 'Aktivite düzeyin güncellendi', adj: { ok: true, allowed: false, oldRestMin: 2659 } }), null);
});

Deno.test('mem#5: a failed band write produces no card either', () => {
  assertEquals(tdeeRecalcCardText({ ...card, adj: { ok: false, allowed: true, error: 'boom' } }), null);
});

Deno.test('mem#5: an applied band is announced with the ENGINE\'s floored numbers and the real trigger', () => {
  const txt = tdeeRecalcCardText({
    ...card, trigger: 'Aktivite düzeyin güncellendi',
    adj: { ok: true, allowed: true, oldRestMin: 2659, newRestMin: 1773, newRestMax: 1987, projectedDays: 3 },
  });
  assertEquals(txt, 'Aktivite düzeyin güncellendi. Yeni TDEE 2130 kcal, dinlenme aralığı 1773–1987 kcal, protein 144 g, su 2.6 L.');
  assert(!txt!.includes('Rutin kontrol'));
});

Deno.test('mem#5: maintenance keeps the range wording; weight-driven reasons are unchanged', () => {
  assertEquals(
    tdeeRecalcCardText({ ...card, adj: null }),
    'Rutin kontrol: hedeflerini güncel kilona göre tazeledim. Yeni TDEE 2130 kcal, protein 144 g, su 2.6 L. (Bakım dönemi: kalori aralığın korunuyor.)',
  );
  const applied = { ok: true, allowed: true, newRestMin: 1800, newRestMax: 2000 };
  assert(tdeeRecalcCardText({ ...card, lastWeight: 82.5, adj: applied })!.startsWith('Kilon 82,5 → 80,0 kg değişti.'));
  assert(tdeeRecalcCardText({ ...card, lastWeight: null, adj: applied })!.startsWith('İlk TDEE hesaplaman hazır.'));
});

// ─────────────────────────────────────────────────────────────────────────────
// recoveryWeekLines — no weekly verdict from an incomplete week (diff#8)
// ─────────────────────────────────────────────────────────────────────────────
Deno.test('diff#8: an unknown week prints BILINMIYOR and NO "Hafta kurtarilabilir" verdict', () => {
  const r = recoveryWeekLines({ weeklyRemaining: 9800, excess: 900, daysLeftInWeek: 3, severity: 'significant', unloggedPastDays: 2 });
  assert(r.weekLine.startsWith('Haftalik kalan: BILINMIYOR (bu haftanin 2 gunu kayitsiz'));
  assert(!r.weekLine.includes('9800'));
  assertEquals(r.verdictLine, 'Ciddiyet: significant');
});

Deno.test('diff#8: a fully logged week keeps the number and the verdict', () => {
  const ok = recoveryWeekLines({ weeklyRemaining: 4200, excess: 600, daysLeftInWeek: 3, severity: 'moderate', unloggedPastDays: 0 });
  assertEquals(ok.weekLine, 'Haftalik kalan: 4200 kcal | Haftada 3 gun kaldi');
  assertEquals(ok.verdictLine, 'Ciddiyet: moderate | Hafta kurtarilabilir: EVET');
  const over = recoveryWeekLines({ weeklyRemaining: 0, excess: 900, daysLeftInWeek: 1, severity: 'significant', unloggedPastDays: 0 });
  assertEquals(over.verdictLine, 'Ciddiyet: significant | Hafta kurtarilabilir: HAYIR');
});
