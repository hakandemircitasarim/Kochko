import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { classifyPlanIntent, isOnboardingHint, isPlanMode, resolveTurnMode, wantsToDropIntent } from './turn.ts';
import { detectTaskMode } from './task-modes.ts';

const base = {
  isOnboarding: false,
  onboardingHintEnabled: true,
  activeIntentEnabled: true,
  taskModeHint: undefined as unknown,
  activeIntent: null as { kind?: string; plan_type?: string } | null,
};

Deno.test('ALGI-01: all 13 onboarding cards resolve to the ONBOARDING contract, not to whatever their prefill sentence looks like', () => {
  // These are the real prefill sentences the client sends (src/services/onboarding-tasks.service.ts).
  // MEASURED against detectTaskMode, exactly 4 of the 13 misroute today:
  //   allergies         -> 'qa'       ("sorunlarım" contains the substring "soru")
  //   kitchen_logistics -> 'recipe'   ("pişirme")
  //   sleep_patterns    -> 'register' ("uyku")  <- the card the owner reported as "koç aptal"
  //   home_environment  -> 'recipe'   ("yemek yapma")
  // The worst is `allergies`: 'qa' resolves to the qa_general retrieval plan — Layer-1 minimal,
  // Layer-2 none, Layer-3 zero days AND confidenceLevel hardcoded 'high'. The card that collects
  // ALLERGIES runs with the least context and the most confidence in the whole app.
  // The REAL registry, verbatim from src/services/onboarding-tasks.service.ts — all 13 cards,
  // so this test fails the day a new card is added with a prefill that trips a keyword.
  const cards: [string, string][] = [
    ['onboarding_introduce_yourself', 'Merhaba! Kendimi tanıtmak istiyorum.'],
    ['onboarding_set_goal', 'Hedeflerimi konuşmak istiyorum.'],
    ['onboarding_daily_routine', 'Günlük rutinimi ve iş hayatımı anlatmak istiyorum.'],
    ['onboarding_eating_habits', 'Beslenme alışkanlıklarım ve günlük yeme düzenim hakkında konuşalım.'],
    ['onboarding_allergies', 'Yiyecek alerjilerim, intoleranslarım ve sindirim sorunlarım hakkında konuşalım.'],
    ['onboarding_kitchen_logistics', 'Mutfak imkânlarım, pişirme becerim ve bütçem hakkında konuşalım.'],
    ['onboarding_exercise_history', 'Spor geçmişim, deneyimim ve tercihlerim hakkında konuşmak istiyorum.'],
    ['onboarding_health_history', 'Sağlık geçmişim, ameliyatlarım, kullandığım ilaçlar ve hormon durumum hakkında konuşalım.'],
    ['onboarding_weight_history', 'Kilo verme geçmişim ve daha önce denediğim diyetler hakkında konuşmak istiyorum.'],
    ['onboarding_lab_values', 'Kan tahlil sonuçlarımı paylaşmak istiyorum.'],
    ['onboarding_sleep_patterns', 'Uyku düzenim ve kalitem hakkında konuşmak istiyorum.'],
    ['onboarding_stress_motivation', 'Stres kaynaklarım, motivasyonum ve en büyük zorluğum hakkında konuşalım.'],
    ['onboarding_home_environment', 'Ev ortamım ve yemek yapma durumum hakkında konuşalım.'],
  ];

  for (const [hint, prefill] of cards) {
    const rawMode = detectTaskMode(prefill, false);
    const r = resolveTurnMode({ ...base, rawMode, taskModeHint: hint });
    assertEquals(r.mode, 'onboarding', `${hint} must run the onboarding contract (raw was '${rawMode}')`);
    assertEquals(r.source, 'onboarding_hint');
    assertEquals(r.rawMode, rawMode, 'the raw value survives as a diagnostic');
  }
});

Deno.test('the onboarding rule is INERT while its gate is off (old behaviour preserved)', () => {
  const rawMode = detectTaskMode('Uyku düzenim ve kalitem hakkında konuşmak istiyorum.', false);
  const r = resolveTurnMode({ ...base, rawMode, taskModeHint: 'onboarding_sleep_patterns', onboardingHintEnabled: false });
  assertEquals(r.mode, rawMode);
  assertEquals(r.source, 'detected');
});

Deno.test('an open plan negotiation outranks a keyword-less message', () => {
  // "peki neden 1900 kalori?" carries no plan keyword; today it drops the user out of the plan
  // conversation mid-negotiation.
  const rawMode = detectTaskMode('peki neden 1900 kalori?', false);
  const r = resolveTurnMode({ ...base, rawMode, activeIntent: { kind: 'plan', plan_type: 'diet' } });
  assertEquals(r.mode, 'plan_diet');
  assertEquals(r.source, 'active_intent');

  const w = resolveTurnMode({ ...base, rawMode, activeIntent: { kind: 'plan', plan_type: 'workout' } });
  assertEquals(w.mode, 'plan_workout');
});

Deno.test('active_intent never overrides onboarding, and is inert while its gate is off', () => {
  const rawMode = detectTaskMode('merhaba', true);
  const onb = resolveTurnMode({ ...base, rawMode, isOnboarding: true, activeIntent: { kind: 'plan', plan_type: 'diet' } });
  assertEquals(onb.mode, 'onboarding');

  const off = resolveTurnMode({ ...base, rawMode: 'coaching', activeIntent: { kind: 'plan', plan_type: 'diet' }, activeIntentEnabled: false });
  assertEquals(off.mode, 'coaching');
  assertEquals(off.source, 'detected');
});

Deno.test('an explicit plan hint still wins over detection', () => {
  const r = resolveTurnMode({ ...base, rawMode: 'coaching', taskModeHint: 'plan_diet' });
  assertEquals(r.mode, 'plan_diet');
  assertEquals(r.source, 'client_hint');
});

Deno.test('an unknown hint is ignored rather than trusted', () => {
  const r = resolveTurnMode({ ...base, rawMode: 'coaching', taskModeHint: 'plan_supper' });
  assertEquals(r.mode, 'coaching');
  assertEquals(r.source, 'detected');
});

Deno.test('helpers', () => {
  assertEquals(isOnboardingHint('onboarding_set_goal'), true);
  assertEquals(isOnboardingHint('plan_diet'), false);
  assertEquals(isOnboardingHint(undefined), false);
  assertEquals(isPlanMode('plan_workout'), true);
  assertEquals(isPlanMode('coaching'), false);
  for (const m of ['boş ver', 'vazgeçtim', 'başka bir konu konuşalım', 'iptal']) {
    assertEquals(wantsToDropIntent(m), true, m);
  }
  for (const m of ['kahvaltıda yumurta olmasın', 'peki neden 1900 kalori', 'tamam olur']) {
    assertEquals(wantsToDropIntent(m), false, m);
  }
});

Deno.test('A7: a QUESTION about the plan is not a request for a new one', () => {
  // Each of these previously counted as "no snapshot produced" → a second ~8000-token generation
  // that overwrote the draft the user was reading, or replaced the answer with an error sentence.
  for (const m of ['peki neden 1900 kalori?', 'bunu neye göre hesapladın', 'niçin bu kadar protein var', 'anlamadım, açıklar mısın']) {
    assertEquals(classifyPlanIntent(m, true), 'explain', m);
  }
});

Deno.test('A7: a change request is still a revision, even when phrased as a question', () => {
  assertEquals(classifyPlanIntent('kahvaltıyı neden yumurta yaptın, değiştir', true), 'revise');
  assertEquals(classifyPlanIntent('sabaha yulaf olmasın', true), 'revise');
  assertEquals(classifyPlanIntent('somon yerine tavuk ekle', true), 'revise');
});

Deno.test('A7: with no draft yet, everything is a generation request', () => {
  assertEquals(classifyPlanIntent('bana haftalık diyet listesi hazırla', false), 'generate');
  assertEquals(classifyPlanIntent('neden 1900 kalori', false), 'generate');
  assertEquals(classifyPlanIntent('', false), 'generate');
});

Deno.test('A7: the approval signal outranks the text', () => {
  assertEquals(classifyPlanIntent('değiştir', true, true), 'approve');
});

Deno.test('D4: distress routes to coaching, a plain mood report still logs', () => {
  // Each of these used to run as REGISTER — gpt-4o-mini, temp 0.2, "tek cümle onay" — at the
  // user's most fragile moment.
  for (const m of ['çok stresliyim, bunaldım', 'bugün ağlamak istiyorum', 'kendimi çok kötü hissediyorum', 'tükendim artık dayanamıyorum']) {
    assertEquals(detectTaskMode(m, false), 'coaching', m);
  }
  // Plain mood REPORTS keep logging (they are data, not distress).
  for (const m of ['keyfim yerinde bugün', 'bugün mutluyum', 'bugün enerjik hissediyorum']) {
    assertEquals(detectTaskMode(m, false), 'register', m);
  }
});
