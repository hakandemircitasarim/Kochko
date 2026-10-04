import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { detectEDRisk } from './guardrails.ts';

// JS \b only knows ASCII letters: the old /\bama\b/ also matched inside "amaç"/"aşama", cutting
// the clause early so a real refusal ("...amaçlı kullanmıyorum") stopped negating the trigger.
Deno.test('ED clause split: "ama" inside a Turkish word does not break the clause', () => {
  const r = detectEDRisk('laksatif amaçlı kullanmıyorum');
  assertEquals(r.isRisk && r.severity === 'high', false);
});

import { scanReplyForAllergens } from './guardrails.ts';

// Live 2026-10-04: a plan with NO seafood got "deniz ürünleri alerjin kayıtlı — öneri uygun
// olmayabilir" because its reasoning said seafood was "kullanılmadı" (passive avoidance form).
Deno.test('allergen scan: passive avoidance phrasing counts as addressed', () => {
  const allergens = [{ name: 'deniz ürünleri', severity: 'moderate' as const }];
  assertEquals(scanReplyForAllergens('Deniz ürünleri alerjin nedeniyle planda deniz ürünleri kullanılmadı.', allergens).violated, false);
  assertEquals(scanReplyForAllergens('Menü deniz ürünleri içermiyor.', allergens).violated, false);
  // a real recommendation still trips the scan
  assertEquals(scanReplyForAllergens('Akşam için ızgara karides ve deniz ürünleri salatası öneririm.', allergens).violated, true);
});

// Live 2026-10-04: the hidden-allergen warning itself ("köftede yumurta olabilir, garsona sor")
// tripped the severe-allergen HARD BLOCK and the whole helpful reply was replaced.
Deno.test('allergen scan: an ask/may-contain caveat counts as addressed', () => {
  const allergens = [{ name: 'yumurta', severity: 'severe' as const }];
  assertEquals(scanReplyForAllergens('Köfte içinde yumurta olabilir; yumurta var mı diye garsona sor.', allergens).violated, false);
  assertEquals(scanReplyForAllergens('Şnitzel pane harcı yumurta içerebilir, şiş tercih et.', allergens).violated, false);
  assertEquals(scanReplyForAllergens('Kahvaltıda menemen ye, yumurta proteini iyi gelir.', allergens).violated, true);
});
