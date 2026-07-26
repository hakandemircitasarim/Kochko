/**
 * Safety-critical guardrail regression tests (Spec 12.2/12.3/12.4/12.5).
 *
 * WHY THIS FILE EXISTS: crisis / ED / allergen detection are the app's highest-stakes
 * decisions, and they are hand-maintained Turkish keyword lists + regexes. A one-character
 * edit can silently disable a suicide-crisis referral or an allergen block with nothing to
 * catch it. These tests are that net. Pure computation only — no network, no DB, no LLM —
 * so they run instantly in CI: `deno test supabase/functions/shared/guardrails.test.ts`.
 *
 * Add a case here BEFORE touching any regex/keyword list in guardrails.ts.
 */
import {
  checkAllergens,
  scanReplyForAllergens,
  buildAllergenBlockMessage,
  extractDeclaredAllergens,
  detectCrisis,
  detectEDRisk,
  detectEmergency,
  detectTaskSkipIntent,
  normalizeClockTime,
} from './guardrails.ts';

// ── minimal assertions (no external deps so the net never breaks on a registry hiccup) ──
function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}
function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) throw new Error(`ASSERT FAILED: ${msg}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// checkAllergens — the detection primitive everything else builds on
// ─────────────────────────────────────────────────────────────────────────────
Deno.test('checkAllergens: safe meal passes', () => {
  ok(checkAllergens('tavuk göğsü ve pilav', ['fıstık']).passed, 'chicken+rice must be safe for a peanut allergy');
});

Deno.test('checkAllergens: direct Turkish mention is caught', () => {
  ok(!checkAllergens('kahvaltıda fıstık ezmesi', ['fıstık']).passed, 'peanut butter must fail for a peanut allergy');
});

Deno.test('checkAllergens: "yer fıstığı" compound is caught (anaphylaxis path)', () => {
  ok(!checkAllergens('yer fıstığı ezmesi harika', ['fıstık']).passed, 'yer fıstığı must fail');
});

Deno.test('checkAllergens: Turkish inflection matches the bare stem', () => {
  // "fındığı" (accusative + consonant softening k→ğ) must reduce to "fındık".
  ok(!checkAllergens('bir avuç fındığı ye', ['fındık']).passed, 'fındığı must match fındık');
});

Deno.test('checkAllergens: category allergen expands to member foods', () => {
  // "deniz ürünleri" must catch a shrimp/salmon suggestion (#R2-12).
  ok(!checkAllergens('ızgara karides tabağı', ['deniz ürünleri']).passed, 'karides must fail for deniz ürünleri');
  ok(!checkAllergens('fırında somon', ['deniz ürünleri']).passed, 'somon must fail for deniz ürünleri');
});

Deno.test('checkAllergens: tree-nut cross-reactivity (badem ⊂ fındık group)', () => {
  ok(!checkAllergens('badem sütü', ['fındık']).passed, 'badem must fail for a tree-nut (fındık) allergy');
});

Deno.test('checkAllergens: no false positive — bal (honey) ≠ balık (fish)', () => {
  ok(checkAllergens('bal ve kaymak', ['balık']).passed, 'honey must NOT trip a fish allergy');
});

Deno.test('checkAllergens: ASCII roots match at a word boundary only', () => {
  ok(checkAllergens('eggplant parmesan', ['yumurta']).passed, 'eggplant must NOT trip an egg allergy');
  ok(!checkAllergens('scrambled egg', ['yumurta']).passed, 'egg must trip an egg allergy');
});

// ─────────────────────────────────────────────────────────────────────────────
// scanReplyForAllergens — the NEW output-side enforcement (Spec 12.4)
// ─────────────────────────────────────────────────────────────────────────────
Deno.test('scanReplyForAllergens: clean reply is not a violation', () => {
  const r = scanReplyForAllergens('tavuk ve pilav öneriyorum', [{ name: 'fıstık', severity: 'severe' }]);
  ok(!r.violated, 'clean reply must not violate');
  eq(r.worstSeverity, null, 'no severity on a clean reply');
});

Deno.test('scanReplyForAllergens: severe allergen recommended → violated + severe (BLOCK path)', () => {
  const r = scanReplyForAllergens('kahvaltıda fıstık ezmesi harika olur', [{ name: 'fıstık', severity: 'severe' }]);
  ok(r.violated, 'recommended peanut must violate');
  eq(r.worstSeverity, 'severe', 'severity must surface as severe');
  ok(r.matched.includes('fıstık'), 'matched must name the allergen');
});

Deno.test('scanReplyForAllergens: INFLECTED severe allergen still BLOCKS (adversarial: "fındığı" ⊄ "fındık" as substring)', () => {
  // Regression guard: presence must use the inflection-aware matcher, not a plain substring —
  // else "fındığı" (accusative + k→ğ softening) mis-routes a severe allergen to the warn path.
  const r = scanReplyForAllergens('bir avuç fındığı ye', [{ name: 'fındık', severity: 'severe' }]);
  ok(r.violated, 'inflected fındığı must violate a fındık allergy');
  eq(r.worstSeverity, 'severe', 'inflected severe hit must still be classified severe → BLOCK, not WARN');
});

Deno.test('scanReplyForAllergens: moderate allergen recommended → violated + moderate (WARN path)', () => {
  const r = scanReplyForAllergens('yanında bir kase yoğurt ekle', [{ name: 'laktoz', severity: 'moderate' }]);
  ok(r.violated, 'yogurt must violate a lactose intolerance');
  eq(r.worstSeverity, 'moderate', 'severity must surface as moderate');
});

Deno.test('scanReplyForAllergens: allergen next to a decline phrase is ADDRESSED (not a violation)', () => {
  const r = scanReplyForAllergens('fıstık yerine badem öneririm', [{ name: 'fıstık', severity: 'severe' }]);
  ok(!r.violated, '"fıstık yerine ..." is a decline, must not violate');
});

Deno.test('scanReplyForAllergens: fail-safe — a 2nd un-hedged mention (>50 chars away) re-arms the violation', () => {
  // First mention is declined; a later un-hedged recommendation, well past the ±50-char decline
  // window, must NOT be silenced by the earlier "yerine". (Guards the AI/HIGH first-occurrence
  // false-negative fix — a decline can only "address" a mention within 50 chars of it.)
  const reply =
    'Fıstık yerine badem tercih edebilirsin, çok daha sağlıklı bir seçim olur senin için. ' +
    'Bugünkü antrenmandan sonra kesinlikle bol bol fıstık ezmesi yemelisin, gerçekten çok iyi gelecek.';
  const r = scanReplyForAllergens(reply, [{ name: 'fıstık', severity: 'severe' }]);
  ok(r.violated, 'the second, un-hedged peanut recommendation must re-arm the violation');
  eq(r.worstSeverity, 'severe', 'still severe');
});

Deno.test('scanReplyForAllergens: NAMING the allergy is not recommending the food (live false-positive)', () => {
  // "Sağlık kayıtlarımda ne var?" → the coach listing the user's own record was hard-blocked.
  for (const reply of [
    'Kayıtlarında fıstık alerjisi ve sol diz menisküs ameliyatı görüyorum.',
    'Fıstığa karşı alerjin olduğu için menülerini ona göre kuruyorum.',
    'Alerjiler: fıstık (şiddetli). Bunun dışında kronik bir durum görünmüyor.',
  ]) {
    const r = scanReplyForAllergens(reply, [{ name: 'fıstık', severity: 'severe' }]);
    ok(!r.violated, `naming the allergy must not violate: "${reply}"`);
  }
});

Deno.test('scanReplyForAllergens: INFLECTED naming ("fıstığa karşı alerjin") is localisable and not a violation', () => {
  // The presence matcher finds softened forms; the localiser must too — else the fail-safe
  // "not localisable" branch blocks the coach's own safety sentence (live false-positive).
  const r = scanReplyForAllergens(
    'Fıstığa karşı şiddetli alerjin olduğu için tatlı önerilerimde buna her zaman dikkat edeceğim.',
    [{ name: 'fıstık', severity: 'severe' }],
  );
  ok(!r.violated, 'inflected allergy-naming must not violate');
});

Deno.test('scanReplyForAllergens: INFLECTED recommendation still BLOCKS after the stem fix', () => {
  const r = scanReplyForAllergens('tatlı krizinde fıstığı yoğurda banıp yiyebilirsin', [{ name: 'fıstık', severity: 'severe' }]);
  ok(r.violated, 'inflected peanut recommendation must violate');
  eq(r.worstSeverity, 'severe', 'and stay severe');
});

Deno.test('scanReplyForAllergens: the "(alerjin yoksa)" disclaimer hole STAYS closed after the naming fix', () => {
  // #live-L4 rule — a blanket allergy disclaimer near the food is NOT a decline. The naming
  // exemption is deliberately tight (compound forms only) so these still BLOCK.
  const r1 = scanReplyForAllergens('fıstık ezmesi dene, alerjin yoksa harika bir protein kaynağı', [{ name: 'fıstık', severity: 'severe' }]);
  ok(r1.violated, 'disclaimer-next-to-recommendation must still violate');
  const r2 = scanReplyForAllergens('Fıstık alerjin var ama az miktarda fıstık ezmesi sorun olmaz bence, dene.', [{ name: 'fıstık', severity: 'severe' }]);
  ok(r2.violated, 'naming followed by an un-hedged recommendation must re-arm the violation');
  eq(r2.worstSeverity, 'severe', 'still severe');
});

Deno.test('scanReplyForAllergens: worst severity wins across multiple matched allergens', () => {
  const r = scanReplyForAllergens('fıstık ezmesi ve bir bardak süt', [
    { name: 'fıstık', severity: 'moderate' },
    { name: 'laktoz', severity: 'severe' },
  ]);
  ok(r.violated, 'both allergens present');
  eq(r.worstSeverity, 'severe', 'the severe one must win — this decides BLOCK vs WARN');
});

Deno.test('scanReplyForAllergens: unknown severity stays null (caller treats as non-severe)', () => {
  const r = scanReplyForAllergens('fıstık ezmesi ekle', [{ name: 'fıstık', severity: null }]);
  ok(r.violated, 'still a violation');
  eq(r.worstSeverity, null, 'null severity must not be promoted to severe');
});

Deno.test('buildAllergenBlockMessage: names the allergen and omits any food suggestion', () => {
  const msg = buildAllergenBlockMessage(['fıstık']);
  ok(msg.includes('fıstık'), 'block message must name the allergen');
  ok(!/ezmesi|öneririm|öneri:/.test(msg) || msg.includes('göstermiyorum'), 'must be a safe redaction, not a suggestion');
});

// ─────────────────────────────────────────────────────────────────────────────
// extractDeclaredAllergens — input capture
// ─────────────────────────────────────────────────────────────────────────────
Deno.test('extractDeclaredAllergens: declared allergy is captured canonically', () => {
  ok(extractDeclaredAllergens('fıstık alerjim var').includes('fıstık'), 'must capture fıstık');
});

Deno.test('extractDeclaredAllergens: negation captures nothing', () => {
  eq(extractDeclaredAllergens('fıstık alerjim yok').length, 0, 'a negated allergy must capture nothing');
});

// ─────────────────────────────────────────────────────────────────────────────
// detectCrisis — suicide / self-harm (Spec 12.3) — highest-stakes path
// ─────────────────────────────────────────────────────────────────────────────
Deno.test('detectCrisis: explicit suicidal statement fires', () => {
  ok(detectCrisis('artık yaşamak istemiyorum').isCrisis, 'explicit ideation must fire');
  ok(detectCrisis('intihar etmeyi düşünüyorum').isCrisis, 'intihar must fire');
});

Deno.test('detectCrisis: method-based phrasing fires (mastar form)', () => {
  ok(detectCrisis('kendimi asmak istiyorum').isCrisis, 'kendimi asmak must fire (AI-GRD-01)');
});

Deno.test('detectCrisis: crisis reply cites 112 and never invents a hotline', () => {
  const m = detectCrisis('intihar').message;
  ok(m.includes('112'), 'must direct to the verified 112 line');
});

Deno.test('detectCrisis: benign "asma" usage does NOT false-fire', () => {
  ok(!detectCrisis('asma katına çıkalım mı').isCrisis, 'asma (mezzanine/vine) must not trip the self-harm regex');
  ok(!detectCrisis('bugün çok yoruldum ama iyiyim').isCrisis, 'ordinary tiredness must not fire');
});

// ─────────────────────────────────────────────────────────────────────────────
// detectEDRisk — eating disorder (Spec 12.5)
// ─────────────────────────────────────────────────────────────────────────────
Deno.test('detectEDRisk: active purging is high severity', () => {
  const r = detectEDRisk('yine kustum kendimi kötü hissediyorum');
  ok(r.isRisk, 'purging must be a risk');
  eq(r.severity, 'high', 'purging must be high severity');
});

Deno.test('detectEDRisk: dangerously low calorie intake is flagged', () => {
  ok(detectEDRisk('günde sadece 500 kalori yiyorum').isRisk, '500 kcal/day intake must flag');
});

Deno.test('detectEDRisk: a normal calorie figure is not flagged', () => {
  ok(!detectEDRisk('bugün 2000 kalori aldım').isRisk, '2000 kcal must not flag');
});

Deno.test('detectEDRisk: a calorie DEFICIT is not mistaken for intake', () => {
  ok(!detectEDRisk('günde 500 kalori açık veriyorum').isRisk, '"500 kalori açık" is a deficit, not starvation');
});

// ─────────────────────────────────────────────────────────────────────────────
// detectTaskSkipIntent — onboarding topic close/skip (the "konu kapanmıyor" bug)
// ─────────────────────────────────────────────────────────────────────────────
Deno.test('detectTaskSkipIntent: "no fixed pattern" answer is a close, not a gap to re-drill', () => {
  ok(detectTaskSkipIntent('belli bir düzen yok'), 'no fixed pattern must close the topic');
  ok(detectTaskSkipIntent('uyku düzenim yok, çok değişken'), 'irregular sleep must close');
});

Deno.test('detectTaskSkipIntent: explicit move-on / frustration fires', () => {
  ok(detectTaskSkipIntent('bu konuyu kapatalım artık'), 'kapatalım must close');
  ok(detectTaskSkipIntent('uyku konusu kapanmayacak mı artık'), 'frustration-to-close must fire');
  ok(detectTaskSkipIntent('bilmiyorum'), 'bilmiyorum must close');
  ok(detectTaskSkipIntent('başka konu konuşalım'), 'move to another topic must close');
  ok(detectTaskSkipIntent('yeter'), 'yeter must close');
});

Deno.test('detectTaskSkipIntent: "continue filling my profile" is NOT a skip (critical negative)', () => {
  ok(!detectTaskSkipIntent('profilimi doldurmaya devam etmeliyiz'), 'wanting to CONTINUE must not be read as skip');
  ok(!detectTaskSkipIntent('7 saat uyuyorum, kalitesi iyi'), 'a real answer must not be a skip');
});

Deno.test('detectTaskSkipIntent: a content-bearing answer that CONTAINS a skip-ish word does NOT fire (adversarial regressions)', () => {
  // Digit guard: a substantive answer that mentions "değişken" but gives real data must be parsed, not skipped.
  ok(!detectTaskSkipIntent('Uyku saatlerim biraz değişken ama genelde 23:00 yatıp 7 saat uyuyorum, kalitem iyi'),
    'a real bedtime+quality answer must NOT skip-close even with "değişken"');
  // "kapanmıyor" inside a real statement (appetite) is not a close-the-topic request.
  ok(!detectTaskSkipIntent('Akşamları iştahım bir türlü kapanmıyor'), 'appetite statement must not close the topic');
  // "fark etmez" inside a full allergy answer must not skip-close (would clobber the confirmation).
  ok(!detectTaskSkipIntent('Süt ürünlerine alerjim var, marka fark etmez hepsinden oluyorum'),
    'a full allergy answer must not be read as a skip');
  // A loose bedtime range IS an answer to parse, never a skip.
  ok(!detectTaskSkipIntent('9 12 arası yatıyorum'), 'a bedtime range is data to capture, not a skip');
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeClockTime — TIME-column write guard (the "9 12" batch-crash fix)
// ─────────────────────────────────────────────────────────────────────────────
Deno.test('normalizeClockTime: bare hours and H:MM normalize to HH:MM', () => {
  eq(normalizeClockTime('9'), '09:00', 'bare hour → padded HH:00');
  eq(normalizeClockTime('21'), '21:00', '21 → 21:00');
  eq(normalizeClockTime('23:30'), '23:30', 'already HH:MM');
  eq(normalizeClockTime('9:5'), '09:05', 'H:M → HH:MM padded');
  eq(normalizeClockTime('9.30'), '09:30', 'dot separator');
  eq(normalizeClockTime(21), '21:00', 'numeric input');
});

Deno.test('normalizeClockTime: unparseable / out-of-range values return null (DROPPED, never crash the batch)', () => {
  eq(normalizeClockTime('9 12'), null, 'a RANGE is not a single time → dropped, not a bad TIME literal');
  eq(normalizeClockTime('akşam'), null, 'free text → null');
  eq(normalizeClockTime('25'), null, 'hour out of range → null');
  eq(normalizeClockTime('12:70'), null, 'minute out of range → null');
  eq(normalizeClockTime(''), null, 'empty → null');
  eq(normalizeClockTime(null), null, 'null → null');
});

// ─────────────────────────────────────────────────────────────────────────────
// detectEmergency — acute medical (Spec 12.2)
// ─────────────────────────────────────────────────────────────────────────────
Deno.test('detectEmergency: benign message does not fire', () => {
  ok(!detectEmergency('bugün antrenmanı kaçırdım').isEmergency, 'ordinary message must not be an emergency');
});
