/**
 * Faz 0 #8a (final2#11) — supplement_log ∩ allergen spine. Pure, no I/O.
 *
 * Live: user_constraints had 'deniz ürünleri' (moderate); "aksam yemeginden sonra 1 omega 3 kapsulu
 * aldim" logged as a bare "Supplement kaydedildi" with no warning, while the same coach refused fish
 * and krill oil when asked directly. These cases pin the log path to the advice path.
 */
import {
  supplementAllergenExposure,
  buildSupplementAllergenLine,
  replyWarnsAboutExposure,
  tagHitsAllergen,
} from './supplement-allergens.ts';

function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}
function eq<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`ASSERT FAILED: ${msg}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

const SEAFOOD = [{ name: 'deniz ürünleri', severity: 'moderate' }];

// ── the live repro ──────────────────────────────────────────────────────────

Deno.test('final2#11: untagged "omega 3" for a seafood-allergic user → possible exposure, ask the source', () => {
  const e = supplementAllergenExposure({ name: 'omega 3' }, SEAFOOD);
  ok(e !== null, 'omega-3 must not log silently for a seafood allergy');
  eq(e!.allergens, ['deniz ürünleri'], 'matched subject');
  eq(e!.possible, true, 'plain omega-3 source is ambiguous (fish, krill or algae)');
  ok(e!.sources.includes('balık') && e!.sources.includes('kabuklu'), 'both fish and krill are candidate sources');
  eq(e!.source_hint, 'balık, krill ya da yosun', 'label hint');
  eq(e!.severe, false, 'moderate is not severe');
});

Deno.test('final2#11: the live reply does NOT count as a warning; the fixed line is one gentle question', () => {
  const e = supplementAllergenExposure({ name: 'omega 3' }, SEAFOOD)!;
  ok(!replyWarnsAboutExposure('Akşam sonrası omega-3 ve D vitamini takviyelerini ekliyorum.', e), 'live reply had no warning');
  const line = buildSupplementAllergenLine(e);
  ok(line.includes('deniz ürünleri') && line.includes('omega 3'), 'names the allergy and the item');
  eq((line.match(/\?/g) ?? []).length, 1, 'exactly one question');
  ok(/kaynağı/.test(line) && /yosun/.test(line), 'asks the source with the algae option');
  ok(!line.includes('112'), 'no emergency line for a moderate, ambiguous source');
  // Once appended, the line itself satisfies the check — a second exposure of the same allergen is not repeated.
  ok(replyWarnsAboutExposure(`Ekledim.\n\n${line}`, e), 'appended line counts as the warning');
});

// ── definite sources ────────────────────────────────────────────────────────

Deno.test('fish oil / cod liver oil hit a fish or seafood allergy as definite', () => {
  const a = supplementAllergenExposure({ name: 'balık yağı' }, SEAFOOD);
  ok(a !== null && !a.possible, 'balık yağı is a certain fish source');
  eq(a!.sources, ['balık'], 'source is fish, not the category name');
  const b = supplementAllergenExposure({ name: 'Morina karaciğer yağı' }, [{ name: 'balık', severity: null }]);
  ok(b !== null && !b.possible, 'cod liver oil → fish');
  const c = supplementAllergenExposure({ name: 'balik yagi kapsulu' }, [{ name: 'balik', severity: null }]);
  ok(c !== null && !c.possible, 'ASCII spelling resolves the same');
});

Deno.test('krill is shellfish: hits kabuklu / deniz ürünleri, NOT a fish-only allergy', () => {
  const k = supplementAllergenExposure({ name: 'krill yağı' }, [{ name: 'kabuklu', severity: 'severe' }]);
  ok(k !== null && !k.possible, 'krill → kabuklu, certain');
  eq(k!.sources, ['kabuklu'], 'source');
  eq(k!.severe, true, 'severity carried');
  ok(supplementAllergenExposure({ name: 'krill yağı' }, SEAFOOD) !== null, 'krill → deniz ürünleri');
  eq(supplementAllergenExposure({ name: 'krill yağı' }, [{ name: 'balık', severity: 'severe' }]), null, 'krill is not fish');
  eq(supplementAllergenExposure({ name: 'krill omega-3' }, [{ name: 'balık', severity: 'severe' }]), null,
    'a name that states the source (krill) removes the omega-3 ambiguity');
});

Deno.test('whey / casein hit milk and lactose; egg protein hits egg; soy lecithin hits soy', () => {
  const w = supplementAllergenExposure({ name: 'whey protein' }, [{ name: 'laktoz', severity: 'mild' }]);
  ok(w !== null && !w.possible, 'whey → süt for a lactose intolerance');
  eq(w!.sources, ['süt'], 'source');
  ok(supplementAllergenExposure({ name: 'kazein' }, [{ name: 'süt', severity: null }]) !== null, 'casein → milk');
  ok(supplementAllergenExposure({ name: 'yumurta proteini' }, [{ name: 'yumurta', severity: null }]) !== null, 'egg protein → egg');
  ok(supplementAllergenExposure({ name: 'soy lecithin' }, [{ name: 'soya', severity: null }])?.possible === false, 'soy lecithin is certain soy');
  ok(supplementAllergenExposure({ name: 'lesitin' }, [{ name: 'soya', severity: null }])?.possible === true, 'plain lecithin: soy or sunflower');
  eq(supplementAllergenExposure({ name: 'ayçiçeği lesitini' }, [{ name: 'soya', severity: null }]), null, 'sunflower lecithin is not soy');
});

// ── no false alarms ─────────────────────────────────────────────────────────

Deno.test('no exposure: algae omega-3, unrelated supplements, empty spine', () => {
  eq(supplementAllergenExposure({ name: 'yosun bazlı omega-3' }, SEAFOOD), null, 'algae omega-3 is the safe alternative the coach itself suggests');
  eq(supplementAllergenExposure({ name: 'vegan omega 3' }, SEAFOOD), null, 'vegan omega-3');
  eq(supplementAllergenExposure({ name: 'D vitamini' }, SEAFOOD), null, 'vitamin D');
  eq(supplementAllergenExposure({ name: 'magnezyum' }, SEAFOOD), null, 'magnesium');
  eq(supplementAllergenExposure({ name: 'kreatin' }, [{ name: 'süt', severity: 'severe' }]), null, 'creatine vs milk');
  eq(supplementAllergenExposure({ name: 'L-glutamin' }, [{ name: 'gluten', severity: null }]), null, 'glutamin ≠ gluten');
  eq(supplementAllergenExposure({ name: 'omega 3' }, []), null, 'no allergens → nothing to check');
  eq(supplementAllergenExposure({ name: '' }, SEAFOOD), null, 'no name → nothing to check');
});

Deno.test('tag ↔ allergen concept matching (token equality, never substring)', () => {
  ok(tagHitsAllergen('balık', 'deniz ürünleri'), 'fish ⊂ seafood');
  ok(tagHitsAllergen('kabuklu', 'deniz ürünleri'), 'shellfish ⊂ seafood');
  ok(tagHitsAllergen('balik', 'somon'), 'ASCII tag vs a member food');
  ok(tagHitsAllergen('süt', 'laktoz'), 'milk vs lactose');
  ok(tagHitsAllergen('sut', 'süt ürünleri'), 'compound subject');
  ok(tagHitsAllergen('süt', 'laktoz intoleransı'), 'inflected compound subject');
  ok(tagHitsAllergen('kabuklu', 'kabuklu deniz ürünleri'), 'compound shellfish subject');
  ok(!tagHitsAllergen('balık', 'kabuklu'), 'fish ≠ shellfish');
  ok(!tagHitsAllergen('kabuklu', 'balık'), 'shellfish ≠ fish');
  ok(!tagHitsAllergen('balık', 'bal'), 'honey allergy is not fish (bal ⊄ balık by token)');
  ok(!tagHitsAllergen('süt', 'deniz ürünleri'), 'generic heads (ürün) never link two concepts');
});

// ── the model's structured tags ─────────────────────────────────────────────

Deno.test('model tags decide when the name says nothing; may_contain is a possible source', () => {
  const t = supplementAllergenExposure({ name: 'Brand X kapsül', allergens: ['balik'] }, SEAFOOD);
  ok(t !== null && !t.possible, 'allergens tag → definite');
  eq(t!.sources, ['balık'], 'tag canonicalised');
  const m = supplementAllergenExposure({ name: 'Brand Y tablet', may_contain: ['soya'] }, [{ name: 'soya', severity: null }]);
  ok(m !== null && m.possible, 'may_contain → possible');
  const s = supplementAllergenExposure({ name: 'Brand Z', allergens: 'sut' }, [{ name: 'süt', severity: null }]);
  ok(s !== null, 'a single string tag is accepted');
  eq(supplementAllergenExposure({ name: 'Brand Z', allergens: [1, null, ''] }, SEAFOOD), null, 'junk tags are ignored');
});

Deno.test('the table can only ADD: an empty model tag list never clears a known source', () => {
  const e = supplementAllergenExposure({ name: 'balık yağı', allergens: [], may_contain: [] }, SEAFOOD);
  ok(e !== null && !e.possible, 'fish oil still hits with allergens: []');
});

Deno.test('custom allergen named in the item: dictionary match on the name', () => {
  const e = supplementAllergenExposure({ name: 'çilekli multivitamin' }, [{ name: 'çilek', severity: null }]);
  ok(e !== null && !e.possible, 'çilek named in the item');
  eq(e!.sources, ['çilek'], 'the subject itself is the source');
});

// ── wording ─────────────────────────────────────────────────────────────────

Deno.test('severe definite exposure: clear caution + 112 line; severe possible: do not use until sure', () => {
  const d = supplementAllergenExposure({ name: 'krill yağı' }, [{ name: 'kabuklu', severity: 'severe' }])!;
  const dl = buildSupplementAllergenLine(d);
  ok(dl.startsWith('⚠️ Dikkat:') && dl.includes('ciddi kabuklu alerjisi') && dl.includes('kabuklu deniz ürünü'), 'definite wording');
  ok(dl.includes("112'yi ara"), 'severe → reaction/112 line');
  const p = supplementAllergenExposure({ name: 'omega 3' }, [{ name: 'deniz ürünleri', severity: 'severe' }])!;
  ok(buildSupplementAllergenLine(p).includes('Emin olana kadar kullanma'), 'severe + ambiguous → hold until the source is known');
});

Deno.test('reply check: names the allergy + the allergen/source; inflection-tolerant; other allergies do not count', () => {
  const e = supplementAllergenExposure({ name: 'omega 3' }, SEAFOOD)!;
  ok(replyWarnsAboutExposure('Deniz ürünleri alerjin olduğu için omega-3 kaynağına bir bakalım: balık mı, krill mi?', e), 'explicit warning');
  ok(replyWarnsAboutExposure('Balığa karşı hassasiyetin var, kapsülün kaynağını kontrol et.', e), 'inflected source + sensitivity word');
  ok(!replyWarnsAboutExposure('Fıstık alerjin kayıtlı, dikkat et. Omega-3 eklendi.', e), 'a different allergy is not this warning');
  ok(!replyWarnsAboutExposure('Omega-3 balık yağından yapılır, eklendi.', e), 'no allergy word → not a warning');
});
