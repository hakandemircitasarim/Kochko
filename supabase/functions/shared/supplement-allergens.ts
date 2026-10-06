/**
 * Supplement ∩ allergen spine — v2 §7.1 "tüketim denetimi", Faz 0 #8a (final2#11).
 *
 * Live: a seafood-allergic user wrote "1 omega 3 kapsülü aldım" and got a bare "Supplement
 * kaydedildi" — supplement_log never ran an allergen check, while the same coach later refused to
 * recommend fish or krill oil to that user. The log path and the advice path disagreed.
 *
 * Contract (AI-first): the MODEL tags the product's allergen sources on the action
 * (`allergens` = certain, `may_contain` = ambiguous source). Code only intersects
 * (tags ∪ may_contain ∪ the small safety table below ∪ the dictionary match on the item name)
 * with the user's allergen/intolerance spine. The table can only ADD sources, never clear a tag
 * (§7.1 "Sözlük yalnızca etiket ekleyebilir"); it exists for legacy/untagged actions (the
 * deterministic supplement net injects `{type, name}` only).
 *
 * A hit never blocks the write: the user reported something they TOOK, which is a fact. The
 * receipt carries `allergen_exposure` and the reply must carry the warning (zorunlu satır) — the
 * fixed line below is appended only when the reply doesn't already warn.
 *
 * Pure: no I/O, unit-tested in supplement-allergens.test.ts.
 */
import { ALLERGEN_FOODS, checkAllergens, foodMatchKey } from './guardrails.ts';
import type { AllergenExposure } from './contracts/turn-envelope.ts';

/** One active allergen/intolerance row (spine ∪ legacy food_preferences), as the caller loaded it. */
export interface SpineAllergen {
  name: string;
  severity?: string | null;
}

/** The supplement_log action fields this check reads. */
export interface SupplementAllergenInput {
  name: string;
  allergens?: unknown;
  may_contain?: unknown;
}

/** Fold Turkish letters to ASCII so "balık yağı" and "balik yagi" are the same key. */
function fold(s: string): string {
  return s.toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The source tags the system prompt teaches (ASCII-folded spelling → canonical name). An unknown
 * tag ("çilek", "deniz ürünleri") passes through as-is and still matches via the concept sets.
 */
const TAG_CANON: Record<string, string> = {
  balik: 'balık', fish: 'balık',
  kabuklu: 'kabuklu', kabuklular: 'kabuklu', shellfish: 'kabuklu', crustacean: 'kabuklu', krill: 'kabuklu',
  sut: 'süt', milk: 'süt', dairy: 'süt',
  yumurta: 'yumurta', egg: 'yumurta',
  soya: 'soya', soy: 'soya',
  gluten: 'gluten', bugday: 'gluten', wheat: 'gluten',
  fistik: 'fıstık', 'yer fistigi': 'fıstık', peanut: 'fıstık',
  findik: 'fındık', kuruyemis: 'fındık', 'agac yemisi': 'fındık', 'tree nut': 'fındık',
  susam: 'susam', sesame: 'susam',
};

/** How a source reads inside the Turkish warning line. */
const TAG_LABEL: Record<string, string> = {
  kabuklu: 'kabuklu deniz ürünü',
  fıstık: 'yer fıstığı',
  fındık: 'kuruyemiş',
};

interface SupplementAllergenRule {
  /** ASCII-folded keys, matched at a word start (≤3-char keys must be whole words). */
  keys: string[];
  tags: string[];
  /** Source is ambiguous for this product class → ask, don't assert. */
  possible?: boolean;
  /** The name itself says the safe source ("yosun omega-3") → the rule does not apply. */
  unless?: string[];
  /** What to look for on the label when the source is ambiguous. */
  hint?: string;
}

/**
 * SAFETY INVARIANT TABLE (allowed by §2: hard invariants stay in code). Small and explicit on
 * purpose — product classes whose allergen source is well known. It reads the model's action field
 * (the supplement name), never the raw user message.
 */
export const SUPPLEMENT_ALLERGEN_MAP: readonly SupplementAllergenRule[] = [
  // Fish oils: the source is the fish itself.
  { keys: ['balik yag', 'fish oil', 'morina', 'cod liver', 'balik karaciger'], tags: ['balık'] },
  // Krill is a crustacean — shellfish, not fish (a fish allergy alone does not hit it).
  { keys: ['krill'], tags: ['kabuklu'] },
  // Plain omega-3 / EPA / DHA: mostly fish, sometimes krill, sometimes algae → ask the source.
  // When the name already states the source (algae/plant, or fish/krill — the rows above decide
  // those), the ambiguity is gone and this row stays out: "krill omega-3" is not a fish question.
  {
    keys: ['omega', 'epa', 'dha'], tags: ['balık', 'kabuklu'], possible: true,
    unless: ['yosun', 'alg', 'algae', 'algal', 'vegan', 'bitkisel', 'keten', 'chia', 'krill', 'balik', 'fish', 'morina', 'cod'],
    hint: 'balık, krill ya da yosun',
  },
  // Milk proteins.
  { keys: ['whey', 'kazein', 'casein', 'peynir alti', 'sut protein', 'milk protein', 'kolostrum', 'colostrum'], tags: ['süt'] },
  // Egg-based proteins.
  { keys: ['yumurta', 'egg', 'albumin'], tags: ['yumurta'] },
  // Soy.
  { keys: ['soya', 'soy'], tags: ['soya'] },
  // Lecithin is soy or sunflower.
  { keys: ['lesitin', 'lecithin'], tags: ['soya'], possible: true, unless: ['aycice', 'sunflower'], hint: 'soya ya da ayçiçeği' },
  // Glucosamine / chitosan are usually made from crustacean shells.
  { keys: ['glukozamin', 'glucosamine', 'kitosan', 'chitosan'], tags: ['kabuklu'], possible: true, hint: 'kabuklu deniz ürünü ya da bitkisel' },
];

const isLetter = (ch: string | undefined): boolean => !!ch && /\p{L}/u.test(ch);

/** Key at a word start in the folded name; short keys (soy/egg/epa/dha) must be whole words. */
function hasKey(foldedName: string, key: string): boolean {
  let i = foldedName.indexOf(key);
  while (i >= 0) {
    const leftOk = !isLetter(foldedName[i - 1]);
    const rightOk = key.length > 3 || !isLetter(foldedName[i + key.length]);
    if (leftOk && rightOk) return true;
    i = foldedName.indexOf(key, i + 1);
  }
  return false;
}

function canonTag(t: string): string {
  const f = fold(t).slice(0, 40);
  return TAG_CANON[f] ?? t.trim().toLocaleLowerCase('tr').slice(0, 40);
}

/** The model's tag list, defensively: strings only, capped, canonical spelling. */
function cleanTags(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
  return raw
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .slice(0, 8)
    .map(canonTag);
}

/** Every ALLERGEN_FOODS key/member, folded: the only words allowed to link two concepts. */
const VOCAB = new Set<string>(
  [...Object.keys(ALLERGEN_FOODS), ...Object.values(ALLERGEN_FOODS).flat(), 'soya', 'susam'].map(fold),
);

/**
 * The folded food terms a tag/allergen name stands for: itself, its ALLERGEN_FOODS members, and —
 * for compound or inflected names ("süt ürünleri", "laktoz intoleransı", "kabuklu deniz ürünleri")
 * — each word's comparison key, but only when that word is itself allergen vocabulary, so generic
 * heads like "ürün"/"deniz" can never link two unrelated allergens.
 */
function conceptTerms(x: string): Set<string> {
  const l = x.trim().toLocaleLowerCase('tr');
  const heads = new Set<string>([l]);
  for (const w of l.split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 3) continue;
    for (const k of [w, foodMatchKey(w)]) if (VOCAB.has(fold(k))) heads.add(k);
  }
  const out = new Set<string>();
  for (const h of heads) {
    out.add(fold(h));
    const members = ALLERGEN_FOODS[h] ?? ALLERGEN_FOODS[TAG_CANON[fold(h)] ?? ''] ?? [];
    for (const m of members) out.add(fold(m));
  }
  return out;
}

/**
 * Does a source tag hit one of the user's allergen subjects? Concept overlap, both directions:
 * tag "balık" hits "deniz ürünleri" and "somon"; "kabuklu" hits "deniz ürünleri" but NOT "balık";
 * "süt" hits "laktoz" and "süt ürünleri". Token equality only — "bal" (honey) never hits "balık".
 */
export function tagHitsAllergen(tag: string, subject: string): boolean {
  const a = conceptTerms(canonTag(tag));
  for (const t of conceptTerms(subject)) if (a.has(t)) return true;
  return false;
}

/**
 * Intersect one supplement_log action with the user's allergen spine. Returns the receipt flag, or
 * null when nothing hits. A definite source (model `allergens`, a certain table row, the name
 * itself) wins over a possible one (model `may_contain`, an ambiguous table row).
 */
export function supplementAllergenExposure(input: SupplementAllergenInput, spine: SpineAllergen[]): AllergenExposure | null {
  const item = (input.name ?? '').trim().slice(0, 60);
  if (!item || spine.length === 0) return null;

  const sources: { tag: string; definite: boolean; hint?: string }[] = [];
  for (const t of cleanTags(input.allergens)) sources.push({ tag: t, definite: true });
  for (const t of cleanTags(input.may_contain)) sources.push({ tag: t, definite: false });
  const fname = fold(item);
  for (const rule of SUPPLEMENT_ALLERGEN_MAP) {
    if (!rule.keys.some((k) => hasKey(fname, k))) continue;
    if (rule.unless?.some((u) => hasKey(fname, u))) continue;
    for (const t of rule.tags) sources.push({ tag: t, definite: !rule.possible, hint: rule.hint });
  }

  const matched = new Map<string, boolean>(); // subject → severe
  const definiteSources = new Set<string>();
  const possibleSources = new Set<string>();
  let hint: string | null = null;
  for (const a of spine) {
    const subject = (a.name ?? '').trim();
    if (!subject) continue;
    let hit = false;
    let subjectDefinite = false;
    for (const s of sources) {
      if (!tagHitsAllergen(s.tag, subject)) continue;
      hit = true;
      if (s.definite) subjectDefinite = true;
      (s.definite ? definiteSources : possibleSources).add(s.tag);
      if (!s.definite && s.hint && !hint) hint = s.hint;
    }
    // Dictionary match on the item NAME (§7.1 "kalem adında sözlük eşleşmesi") — the same matcher
    // meal_log uses; catches custom allergens no tag covers ("çilekli multivitamin" vs çilek). The
    // name naming the allergen is certain, so it is a definite source when no tag already was.
    if (!checkAllergens(item, [subject]).passed) {
      if (!subjectDefinite) definiteSources.add(subject);
      hit = true;
    }
    if (hit) matched.set(subject, (matched.get(subject) ?? false) || a.severity === 'severe');
  }
  if (matched.size === 0) return null;

  const possible = definiteSources.size === 0;
  return {
    item,
    allergens: [...matched.keys()],
    sources: [...(possible ? possibleSources : definiteSources)],
    possible,
    severe: [...matched.values()].some(Boolean),
    source_hint: possible ? hint : null,
  };
}

const tagLabel = (t: string): string => TAG_LABEL[t] ?? t;

/**
 * The fixed Turkish line (zorunlu satır) for an exposure the reply did not already warn about.
 * Ambiguous source → one gentle question about the label; certain source → a clear caution.
 */
export function buildSupplementAllergenLine(e: AllergenExposure): string {
  const list = e.allergens.join(', ');
  const what = e.severe ? `ciddi ${list} alerjisi` : `${list} hassasiyeti`;
  if (e.possible) {
    const src = e.sources.map(tagLabel).join(' ya da ');
    const hint = e.source_hint ? ` (${e.source_hint})` : '';
    // Severe + already taken: the likely source IS the allergen — the reaction line belongs here too.
    const advice = e.severe
      ? "Emin olana kadar kullanma; eczacına bir sor. Kaşıntı, şişlik ya da nefes darlığı olursa hemen 112'yi ara."
      : 'Emin değilsen eczacına bir sor.';
    return `⚠️ Bu arada, profilinde ${what} kayıtlı ve ${e.item} ${src} kaynaklı olabilir. Kutusunda kaynağı ne yazıyor${hint}? ${advice}`;
  }
  const src = e.sources.map(tagLabel).join(', ');
  const urgent = e.severe ? " Kaşıntı, şişlik ya da nefes darlığı olursa hemen 112'yi ara." : '';
  return `⚠️ Dikkat: profilinde ${what} kayıtlı ve ${e.item} ${src} içeriyor. Kaydettim; kullanmaya devam etmeden önce doktoruna ya da eczacına danış.${urgent}`;
}

const ALLERGY_WORD = /(alerj|hassasiyet|intolerans|duyarl)/u;

/** Search stem: polysyllabic final k/p/ç/t softens before a vowel (balık → balığa, fındık → fındığı). */
function searchStem(t: string): string {
  const f = fold(t);
  return f.length >= 5 && /[kpct]$/.test(f) ? f.slice(0, -1) : f;
}

/**
 * Does the reply (model text + nets appended so far) already warn about THIS exposure? It must
 * name an allergy/sensitivity AND one of the matched allergens or sources. Reads the reply only —
 * never the user's message.
 */
export function replyWarnsAboutExposure(reply: string, e: AllergenExposure): boolean {
  const lower = fold(reply);
  if (!ALLERGY_WORD.test(lower)) return false;
  const terms = [...e.allergens, ...e.sources, ...e.sources.map(tagLabel)];
  return terms.some((t) => {
    const s = searchStem(t);
    return s.length >= 3 && lower.includes(s);
  });
}
