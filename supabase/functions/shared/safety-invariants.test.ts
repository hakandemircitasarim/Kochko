/**
 * §7.1 structured invariants: (tags ∪ may_contain ∪ name dictionary) ∩ severe allergens = ∅ and
 * (loads ∪ name dictionary) ∩ injured regions = ∅. Pure; reads structured fields only.
 */
import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { checkAllergens, filterExercisesByInjury } from './guardrails.ts';
import {
  allergenTagsHit,
  checkSuggestionInvariants,
  injuredRegionsFromSpine,
  injuryLoadHit,
  severeAllergenSubjects,
} from './safety-invariants.ts';

// ─── allergenTagsHit ─────────────────────────────────────────────────────────

Deno.test('allergen: a certain tag on the item hits the user\'s severe allergen', () => {
  assertEquals(allergenTagsHit({ name: 'Kakaolu top', allergens: ['fıstık'] }, ['fıstık']), [{ allergen: 'fıstık', via: 'allergens', tag: 'fıstık' }]);
  assertEquals(allergenTagsHit(['yumurta'], ['yumurta']).length, 1, 'a bare array is the certain tag list');
});

Deno.test('allergen: may_contain is enough (fail-safe), and certain outranks may_contain', () => {
  assertEquals(allergenTagsHit({ name: 'Köfte', may_contain: ['yumurta'] }, ['yumurta'])[0].via, 'may_contain');
  assertEquals(allergenTagsHit({ name: 'Köfte', allergens: ['yumurta'], may_contain: ['yumurta'] }, ['yumurta'])[0].via, 'allergens');
});

Deno.test('allergen: no overlap → empty (the invariant holds)', () => {
  assertEquals(allergenTagsHit({ name: 'Izgara tavuk ve pilav', allergens: [], may_contain: [] }, ['fıstık', 'yumurta']), []);
  assertEquals(allergenTagsHit({ name: 'Elma' }, []), []);
});

Deno.test('allergen: Turkish legacy subjects, EU-14 / English ids and custom slugs meet in one matcher', () => {
  const cases: [string, string][] = [
    ['peanuts', 'fıstık'], ['peanut', 'fistik'], ['tree_nuts', 'fındık'], ['milk', 'süt'], ['dairy', 'laktoz'],
    ['eggs', 'yumurta'], ['fish', 'balık'], ['crustaceans', 'deniz ürünleri'], ['shellfish', 'kabuklu'],
    ['sesame', 'susam'], ['celery', 'kereviz'], ['custom:çilek', 'çilek'], ['custom:cilek', 'Çilek'],
  ];
  for (const [tag, user] of cases) {
    assertEquals(allergenTagsHit({ allergens: [tag] }, [user]).length, 1, `${tag} ↔ ${user}`);
    assertEquals(allergenTagsHit({ allergens: [user] }, [tag]).length, 1, `${user} ↔ ${tag} (both directions)`);
  }
});

Deno.test('allergen: category ↔ member is a hit both ways; sibling members are not', () => {
  assertEquals(allergenTagsHit({ allergens: ['karides'] }, ['deniz ürünleri']).length, 1, 'shrimp is seafood');
  assertEquals(allergenTagsHit({ allergens: ['deniz ürünleri'] }, ['karides']).length, 1, 'a seafood tag may be shrimp');
  assertEquals(allergenTagsHit({ allergens: ['walnut'] }, ['tree_nuts']).length, 1, 'walnut is a tree nut');
  assertEquals(allergenTagsHit({ allergens: ['walnut'] }, ['badem']), [], 'a walnut is not an almond');
  assertEquals(allergenTagsHit({ allergens: ['krill'] }, ['balık']), [], 'krill is a crustacean, not a fish');
  assertEquals(allergenTagsHit({ allergens: ['bal'] }, ['balık']), [], 'honey is not fish (token equality only)');
});

Deno.test('allergen: the name dictionary ADDS hits the model forgot to tag (§7.4.2 superset)', () => {
  // Today's dictionary blocks these names; untagged, the invariant must still block them.
  for (const [name, allergen] of [['Fıstık ezmeli tost', 'fıstık'], ['Menemen', 'yumurta'], ['Sütlaç', 'süt'], ['Somon ızgara', 'balık'], ['Çilekli pasta', 'custom:çilek']] as const) {
    const hit = allergenTagsHit({ name, allergens: [], may_contain: [] }, [allergen]);
    assertEquals(hit, [{ allergen, via: 'name', tag: null }], name);
  }
  // …and can never clear a tag: an innocent name with a real tag still hits.
  assertEquals(allergenTagsHit({ name: 'Kakaolu top', allergens: ['fıstık'] }, ['fıstık'])[0].via, 'allergens');
  // The dictionary can be switched off for tag-only checks.
  assertEquals(allergenTagsHit({ name: 'Menemen' }, ['yumurta'], { nameDictionary: false }), []);
});

Deno.test('allergen: superset of today\'s checkAllergens on item names', () => {
  const names = ['Omlet', 'Yumurtasız pankek', 'Fıstık ezmesi yerine tahinli tost', 'Kaşarlı tost', 'Simit', 'Hamsi tava', 'Karides güveç', 'Bademli kurabiye', 'Elma dilimleri'];
  const allergens = ['yumurta', 'fıstık', 'süt', 'gluten', 'balık', 'deniz ürünleri', 'fındık'];
  for (const name of names) {
    for (const a of allergens) {
      if (!checkAllergens(name, [a]).passed) assert(allergenTagsHit({ name }, [a]).length > 0, `${name} × ${a}`);
    }
  }
});

Deno.test('allergen: vocab expand hook links ids the built-in aliases do not know', () => {
  const expand = (id: string) => (id === 'macadamia_oil' ? ['tree_nuts'] : []);
  assertEquals(allergenTagsHit({ allergens: ['macadamia_oil'] }, ['fındık']), []);
  assertEquals(allergenTagsHit({ allergens: ['macadamia_oil'] }, ['fındık'], { expand }).length, 1);
  // Compound ids already link through their allergen word ("pine_nut" → nut), no hook needed.
  assertEquals(allergenTagsHit({ allergens: ['pine_nut'] }, ['fındık']).length, 1);
});

Deno.test('allergen: junk input is ignored, never thrown on', () => {
  assertEquals(allergenTagsHit({ name: null, allergens: ['', '  '], may_contain: null }, ['', 'fıstık']), []);
});

// ─── injuryLoadHit ───────────────────────────────────────────────────────────

Deno.test('injury: a load on the injured region hits; others do not', () => {
  assertEquals(injuryLoadHit({ name: 'Bulgarian split squat', loads: ['knee', 'hip'] }, ['knee']), [{ region: 'knee', via: 'loads', load: 'knee' }]);
  assertEquals(injuryLoadHit({ name: 'Glute bridge', loads: ['hip'] }, ['shoulder']), []);
  assertEquals(injuryLoadHit(['shoulder', 'elbow'], ['elbow']).length, 1, 'a bare array is the loads list');
});

Deno.test('injury: Turkish labels, plurals and sub-regions meet the dictionary keys', () => {
  assertEquals(injuryLoadHit({ loads: ['knees'] }, ['diz']).length, 1, 'diz = knee');
  assertEquals(injuryLoadHit({ loads: ['lower_back'] }, ['bel']).length, 1, 'bel = back ∋ lower back');
  assertEquals(injuryLoadHit({ loads: ['shoulder'] }, ['sol omuz']).length, 1, 'sol omuz = shoulder');
  assertEquals(injuryLoadHit({ loads: ['quadriceps'] }, ['quad']).length, 1);
});

Deno.test('injury: the exercise dictionary on the NAME adds hits the model forgot to tag', () => {
  assertEquals(injuryLoadHit({ name: 'Barbell squat', loads: [] }, ['knee']), [{ region: 'knee', via: 'name', load: null }]);
  assertEquals(injuryLoadHit({ name: 'Bacak presi', loads: ['quad'] }, ['diz'])[0].via, 'name');
  assertEquals(injuryLoadHit({ name: 'Barbell squat' }, ['knee'], { nameDictionary: false }), []);
});

Deno.test('injury: superset of today\'s filterExercisesByInjury on names', () => {
  const names = ['Back squat', 'Lunge', 'Deadlift', 'Bench press', 'Koşu', 'Şınav', 'Plank', 'Bicycle crunch', 'Yüzme'];
  const parts = ['knee', 'back', 'shoulder', 'wrist', 'ankle'];
  for (const name of names) {
    for (const p of parts) {
      if (filterExercisesByInjury([name], [p]).excluded.length > 0) assert(injuryLoadHit({ name }, [p]).length > 0, `${name} × ${p}`);
    }
  }
});

Deno.test('injury: expand hook for vocab ids', () => {
  assertEquals(injuryLoadHit({ loads: ['achilles'] }, ['ankle']), []);
  assertEquals(injuryLoadHit({ loads: ['achilles'] }, ['ankle'], { expand: (r) => (r === 'achilles' ? ['ankle'] : []) }).length, 1);
});

// ─── spine helpers ───────────────────────────────────────────────────────────

Deno.test('severeAllergenSubjects: severe + unknown + missing severity count; mild/moderate, others\' and retracted do not', () => {
  const rows = [
    { kind: 'allergen', subject: 'fıstık', severity: 'severe' },
    { kind: 'allergen', subject: 'yumurta', severity: 'unknown' },
    { kind: 'allergen', subject: 'susam', severity: null },
    { kind: 'intolerance', subject: 'laktoz', severity: 'mild' },
    { kind: 'allergen', subject: 'kivi', severity: 'moderate' },
    { kind: 'allergen', subject: 'çilek', severity: 'severe', whose: 'other_person' },
    { kind: 'allergen', subject: 'fındık', severity: 'severe', polarity: 'does_not_have' },
    { kind: 'allergen', subject: 'balık', severity: 'severe', active: false },
    { kind: 'injury', subject: 'knee', severity: 'severe' },
    { name: 'deniz ürünleri', severity: null }, // legacy food_preferences row
  ];
  assertEquals(severeAllergenSubjects(rows), ['fıstık', 'yumurta', 'susam', 'deniz ürünleri']);
});

Deno.test('injuredRegionsFromSpine: body_parts first, subject as fallback, own active rows only', () => {
  const rows = [
    { kind: 'injury', subject: 'knee', body_parts: ['knee'] },
    { kind: 'surgery', subject: 'omuz', body_parts: [] },
    { kind: 'injury', subject: 'injury', body_parts: [] }, // v1 placeholder subject → nothing usable
    { kind: 'injury', subject: 'back', body_parts: ['back'], active: false },
    { kind: 'injury', subject: 'ankle', body_parts: ['ankle'], whose: 'other_person' },
    { kind: 'allergen', subject: 'fıstık' },
  ];
  assertEquals(injuredRegionsFromSpine(rows), ['knee', 'omuz']);
});

// ─── checkSuggestionInvariants (T7) ──────────────────────────────────────────

Deno.test('T7: a reply\'s suggestion lists are checked in one call; violations name the items', () => {
  const v = checkSuggestionInvariants(
    {
      foods: [
        { name: 'Hurmalı kakao topları', allergens: [], may_contain: [] },
        { name: 'Mayonezli ton balıklı sandviç', allergens: ['yumurta', 'balık'], may_contain: [] },
        { name: 'Köfte', allergens: [], may_contain: ['yumurta'] },
      ],
      exercises: [{ name: 'Wall sit', loads: ['knee', 'quad'] }, { name: 'Yüzme', loads: ['shoulder'] }],
    },
    { severeAllergens: ['yumurta'], injuredRegions: ['diz'] },
  );
  assertEquals(v.map((x) => `${x.kind}:${x.name}`), ['food:Mayonezli ton balıklı sandviç', 'food:Köfte', 'exercise:Wall sit']);
  assertEquals(checkSuggestionInvariants({ foods: [{ name: 'Elma' }], exercises: [] }, { severeAllergens: [], injuredRegions: [] }), []);
});
