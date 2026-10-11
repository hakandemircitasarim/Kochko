/**
 * Teaching-to-the-test guard (2026-10-11 review): the Stage A prefix must teach PRINCIPLES, not
 * replay eval cases. If a few-shot (or a quoted example in the rules / registry doc) is a copy of a
 * fixture's message, or shows a fixture's exact ref with the same food, that fixture stops measuring
 * whether the model generalises — it measures whether it recalls the example.
 *
 * Pure text comparison over OUR OWN prompt text and fixture data (never a user's message at run
 * time): Turkish lower-case, diacritics folded (fixtures are often typed in ASCII — "yok o yanlis"
 * is "yok o yanlış"), split on anything that is not a letter or digit.
 *
 * What counts as a copy:
 *   · token Jaccard > OVERLAP_JACCARD_MAX between a prompt message/quote and a fixture message;
 *   · a whole fixture message (≥ 3 tokens) inside a prompt message/quote;
 *   · a prompt quote (≥ 3 tokens) inside a fixture message — unless it is one of GRAMMAR_CUES, the
 *     conditional-mood markers the rules exist to teach ("-sem ne olur", "-sem yeter mi");
 *   · a few-shot context line with a fixture's ref AND a shared food word on that ref's line;
 *   · (round 3) more than CONTENT_SHARED_MAX shared content words (by stem: "fındık/fındığa") between
 *     a prompt example and a fixture message — or between a few-shot context line and ANY fixture
 *     ref line, whatever the ref — i.e. the same case in other words;
 *   · (round 3) a shared number+word pair ("2 dilim", "2 değil"): the same amount, the same template;
 *     (round 4) a spelled numeral next to a unit pairs as its digit ("iki dilim" = "2 dilim").
 * The coach's capability text (write-registry capabilities, Stage B) and the tripwire questions
 * Stage A reads as facts (shared/safety-tripwires.ts question_tr) are held to the same checks.
 */

/** Above this token Jaccard a prompt example is a near-copy of a fixture message. */
export const OVERLAP_JACCARD_MAX = 0.6;

/** Quoted phrases shorter than this many tokens are words, not examples (e.g. "2 çimdik", "evet"). */
export const MIN_QUOTE_TOKENS = 3;

/**
 * Grammar cues the rules quote ON PURPOSE: the hypothetical mood is a language pattern, not a case.
 * A fixture that uses the same suffix ("pizza yesem ne olur?") still tests the food, day and
 * simulation the example never shows. Folded spelling.
 */
export const GRAMMAR_CUES: readonly string[] = ['yesem ne olur', 'icsem yeter mi'];

const FOLD: Readonly<Record<string, string>> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

/** Turkish lower-case, folded, letter/digit tokens. */
export function foldTokens(s: string): string[] {
  const low = s.toLocaleLowerCase('tr');
  let folded = '';
  for (const ch of low) folded += FOLD[ch] ?? ch;
  return folded.split(/[^a-z0-9]+/).filter((t) => t !== '');
}

export function tokenJaccard(a: readonly string[], b: readonly string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Is `needle` a contiguous run of `hay`? */
export function containsRun(hay: readonly string[], needle: readonly string[]): boolean {
  if (!needle.length || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length && ok; j++) ok = hay[i + j] === needle[j];
    if (ok) return true;
  }
  return false;
}

/** Every "…" quoted phrase in a prompt text (the examples the model reads). */
export function quotedPhrases(text: string): string[] {
  // Pair quotes left to right (a short quote must not shift the pairing), then drop the words.
  return [...text.matchAll(/"([^"\n]*)"/g)].map((m) => m[1]).filter((q) => q.trim() !== '');
}

export interface TextCase { id: string; text: string }
export interface Overlap { probe: string; fixture: string; why: string }

/** A few-shot message against fixture messages: no near-copy, and no whole fixture message inside it. */
export function messageOverlaps(probes: readonly TextCase[], fixtures: readonly TextCase[], max = OVERLAP_JACCARD_MAX): Overlap[] {
  const out: Overlap[] = [];
  const fx = fixtures.map((f) => ({ id: f.id, toks: foldTokens(f.text) }));
  for (const p of probes) {
    const pt = foldTokens(p.text);
    for (const f of fx) {
      const j = tokenJaccard(pt, f.toks);
      if (j > max) out.push({ probe: p.id, fixture: f.id, why: `Jaccard ${j.toFixed(2)} > ${max}` });
      else if (f.toks.length >= MIN_QUOTE_TOKENS && containsRun(pt, f.toks)) out.push({ probe: p.id, fixture: f.id, why: 'fixture mesajı örneğin içinde aynen geçiyor' });
    }
  }
  return out;
}

/** Quoted examples of the rules / doc against fixture messages (grammar cues allowed). */
export function quoteOverlaps(quotes: readonly TextCase[], fixtures: readonly TextCase[], opts: { max?: number; cues?: readonly string[] } = {}): Overlap[] {
  const max = opts.max ?? OVERLAP_JACCARD_MAX;
  const cues = new Set((opts.cues ?? GRAMMAR_CUES).map((c) => foldTokens(c).join(' ')));
  const out: Overlap[] = [];
  const fx = fixtures.map((f) => ({ id: f.id, toks: foldTokens(f.text) }));
  for (const q of quotes) {
    const qt = foldTokens(q.text);
    if (qt.length < MIN_QUOTE_TOKENS) continue;
    for (const f of fx) {
      const j = tokenJaccard(qt, f.toks);
      if (j > max) out.push({ probe: q.id, fixture: f.id, why: `Jaccard ${j.toFixed(2)} > ${max}` });
      else if (f.toks.length >= MIN_QUOTE_TOKENS && containsRun(qt, f.toks)) out.push({ probe: q.id, fixture: f.id, why: 'fixture mesajı alıntının içinde aynen geçiyor' });
      else if (!cues.has(qt.join(' ')) && containsRun(f.toks, qt)) out.push({ probe: q.id, fixture: f.id, why: 'alıntı fixture mesajının içinde aynen geçiyor' });
    }
  }
  return out;
}

/**
 * Words on a record line that say WHEN or HOW MUCH, not WHAT (days, meal times, units, markers).
 * Folded spelling. A shared token outside this list on the same ref is a shared food/subject.
 */
const LINE_STOP = new Set([
  'bugun', 'dun', 'ogle', 'oglen', 'aksam', 'kahvalti', 'sabah', 'gece', 'ara', 'ogun', 'son', 'tur', 'gun', 'gunluk',
  'paz', 'pzt', 'sal', 'car', 'per', 'cum', 'cmt', 'oca', 'sub', 'mar', 'nis', 'may', 'haz', 'tem', 'agu', 'eyl', 'eki', 'kas',
  'kcal', 'adet', 'porsiyon', 'kase', 'tabak', 'dilim', 'bardak', 'fincan', 'kupa', 'tane', 'yarim', 'litre',
  'model', 'referans', 'reference', 'kullanici', 'ile', 've', 'bir', 'yedim', 'ictim', 'record', 'update', 'kaydinin', 'duzeltmesi',
  'taslagi', 'taslak', 'beslenme', 'antrenman', 'hafta', 'haftasi', 'her',
]);

/** Content words of a record line (after the ref): letters only, ≥ 2 chars, not a stop word. */
export function lineFoods(line: string): Set<string> {
  return new Set(foldTokens(line).filter((t) => /^[a-z]+$/.test(t) && t.length >= 2 && !LINE_STOP.has(t)));
}

export interface RefLineCase { id: string; ref: string; line: string }

/** A few-shot context ref that is also a fixture ref, with a shared content word on both lines. */
export function refFoodOverlaps(shots: readonly RefLineCase[], fixtures: readonly RefLineCase[]): Overlap[] {
  const out: Overlap[] = [];
  for (const s of shots) {
    const sf = lineFoods(s.line);
    for (const f of fixtures) {
      if (f.ref !== s.ref) continue;
      const shared = [...lineFoods(f.line)].filter((t) => sf.has(t));
      if (shared.length) out.push({ probe: `${s.id}:${s.ref}`, fixture: f.id, why: `aynı ref + ortak içerik: ${shared.join(', ')}` });
    }
  }
  return out;
}

// ─── content words and number+unit pairs (review of tuning round 2) ─────────────────────────────
// Token Jaccard misses a paraphrase that keeps the CASE: the same foods in other words ("fındığa"
// vs "fındık"), the same amount of the same thing ("2 dilim …"), the same correction template
// ("2 değil 1 …"). These two checks look at what an example is ABOUT, whatever its wording or ref.

/**
 * Words that say who/when/how, not WHAT (function words, pronouns, auxiliaries, the everyday verbs
 * of a log message, time words, units, quantity words, record-line markers). Folded spelling,
 * matched on the 5-letter stem, so inflections ("yedim/yedik", "bardağı/bardak") fall out together.
 * Anything left is a content word: a food, a drink, an activity, a body part, a symptom — and the
 * words in CONTENT_WORDS_KEPT.
 */
/**
 * Words that LOOK like units or principle vocabulary but are exactly what the eval's hotspot cases
 * are about (review of tuning round 3): "dilim" (the sliced vs whole-cooked food case), "ciddi" and
 * "alerji" (the severe-allergy declaration). Until round 3 they were stop words, so an example could
 * share "ciddi alerji" + a third word with a fixture and still pass. They count as content now: an
 * allergy example may share ONE of them with a fixture (CONTENT_SHARED_MAX), not the whole case.
 */
export const CONTENT_WORDS_KEPT: readonly string[] = ['dilim', 'ciddi', 'alerji'];

const CONTENT_STOP_WORDS = [
  ...[...LINE_STOP].filter((w) => !CONTENT_WORDS_KEPT.includes(w)),
  // weekdays, log verbs in the evidential
  'pazartesi', 'sali', 'carsamba', 'persembe', 'cuma', 'cumartesi', 'pazar', 'ikindi',
  'yemisim', 'yemis', 'icmisim', 'icmis', 'girmissin', 'girmis', 'girdin',
  // function words, pronouns, particles
  've', 'ile', 'ama', 'fakat', 'ise', 'de', 'da', 'ki', 'mi', 'mu', 'bu', 'su', 'o', 'bir', 'hic', 'cok', 'az', 'daha', 'en',
  'gibi', 'kadar', 'icin', 'sonra', 'once', 'beri', 'yine', 'artik', 'zaten', 'sadece', 'bile', 'hem', 'ya', 'yok', 'var',
  'ben', 'bana', 'beni', 'benim', 'sen', 'sana', 'onu', 'ona', 'onun', 'biz', 'siz', 'bunu', 'buna', 'bunun', 'kendi',
  'hangi', 'nasil', 'neden', 'niye', 'nedir', 'kac', 'ne', 'misin', 'musun', 'lazim', 'gerek', 'tamam', 'evet',
  'hayir', 'olur', 'pardon', 'aslinda', 'galiba', 'herhalde', 'sanirim', 'hep', 'her', 'toplam', 'toplamda', 'yaninda',
  'ustune', 'uzerine', 'icinde', 'baska', 'diger', 'tum', 'butun', 'biraz', 'fazla', 'yarim', 'tek', 'iki', 'uc', 'dort', 'bes',
  // everyday verbs of a log / correction / question
  'yedim', 'yedik', 'yemek', 'yiyor', 'yiyeyim', 'yesem', 'ictim', 'icmek', 'iciyor', 'icsem', 'icerken', 'yaptim', 'yapmak',
  'yapti', 'ettim', 'etmek', 'oldu', 'olmus', 'olsun', 'oluyor', 'olmadi', 'yazdim', 'yazmis', 'yazilmis', 'yanlis', 'dogru',
  'duzelt', 'duzeltir', 'sil', 'silin', 'geri', 'iptal', 'ekle', 'eklemeni', 'istemistim', 'istiyorum', 'isterim', 'gideyim',
  'gittim', 'geldi', 'aldim', 'var', 'yeterli', 'yeter', 'koydum', 'attim', 'bilmiyorum', 'emin', 'degil', 'degilim',
  'demek', 'dedim', 'soyle', 'boyle', 'oyle', 'kaldi', 'basla', 'baslayalim', 'cikarir', 'uygun', 'guzel', 'iyi', 'kotu',
  // time words
  'bugun', 'dun', 'yarin', 'sabah', 'ogle', 'oglen', 'aksam', 'gece', 'kahvalti', 'kahvaltida', 'ogun', 'gun', 'gunde', 'gunu', 'gunler', 'hafta',
  'haftada', 'saat', 'dakika', 'simdi', 'az', 'once', 'demin', 'biraz', 'onceki', 'gelecek', 'onumuzdeki',
  // units and quantity words (not "çay"/"tatlı": in "çay kaşığı" they are units, but mostly they are food)
  'adet', 'tane', 'parca', 'porsiyon', 'kase', 'tabak', 'bardak', 'bardagi', 'fincan', 'kupa', 'sise', 'kutu', 'paket',
  'avuc', 'tutam', 'cimdik', 'kasik', 'litre', 'gram', 'kilo', 'kilogram', 'kalori', 'kcal', 'dk',
];

/** Letters of a stem: enough to merge Turkish inflections ("makarna/makarnayı", "fındık/fındığa"). */
export const STEM_LEN = 5;

const stemOf = (t: string) => t.slice(0, STEM_LEN);
const CONTENT_STOP_STEMS = new Set(CONTENT_STOP_WORDS.map(stemOf));

/** Content-word stems of a text: letters only, ≥ 3 letters, not a stop word (by stem). */
export function contentStems(text: string): Set<string> {
  return new Set(foldTokens(text).filter((t) => /^[a-z]{3,}$/.test(t)).map(stemOf).filter((s) => !CONTENT_STOP_STEMS.has(s)));
}

/**
 * Spelled-out Turkish numerals (folded) and the digit form they pair as, so "iki dilim" and
 * "2 dilim", "tek porsiyon" and "1 porsiyon" are ONE amount (review of tuning round 3: the guard
 * only paired digits, so "iki dilim …" never met "2 dilim …").
 */
export const NUMBER_WORDS: Readonly<Record<string, string>> = {
  bir: '1', tek: '1', iki: '2', uc: '3', dort: '4', bes: '5', alti: '6', yedi: '7', sekiz: '8', dokuz: '9', on: '10', yarim: '0.5',
};

/**
 * What a SPELLED numeral pairs with: a unit or quantity word (4-letter prefix, so the inflected and
 * consonant-softened forms count: "tabaktı/tabağı", "porsiyondu", "bardağı", "kaşığı") or the
 * correction template "değil". A digit pairs with any word, but a numeral word also has an everyday
 * meaning — "bir" is the indefinite article ("bir an", "bir şey"), "tek" is "only", "altı" is
 * "under", "yedi" is "ate", folded "on" is also "ön" — so it counts only next to a unit, where it
 * can only be an amount.
 */
const UNIT_PREFIXES: readonly string[] = [
  'adet', 'tane', 'parc', 'pors', 'kase', 'taba', 'dili', 'bard', 'finc', 'kupa', 'sise', 'kutu', 'pake', 'avuc', 'tuta', 'cimd',
  'kasi', 'litr', 'gram', 'kilo', 'kalo', 'kcal', 'saat', 'daki', 'kere', 'defa', 'adim', 'degi',
];
const SHORT_UNITS: ReadonlySet<string> = new Set(['kez', 'gun', 'dk', 'km', 'ml', 'lt']);

/** Is `t` (a folded token) a unit / quantity word or "değil" — what a spelled numeral may pair with? */
export function isUnitWord(t: string): boolean {
  return SHORT_UNITS.has(t) || (t.length >= 4 && UNIT_PREFIXES.includes(t.slice(0, 4)));
}

/**
 * Number + following word pairs ("2 dilim", "1 tabak", "2 degil"), the word stemmed. A digit pairs
 * with any word; a spelled numeral (NUMBER_WORDS) pairs as its digit, but only with a unit word or
 * "değil" (isUnitWord). A number at the end of a text pairs with nothing. Catches a reused amount of
 * a thing AND a reused correction template — the shapes token Jaccard cannot see.
 */
export function numberUnitPairs(text: string): Set<string> {
  const toks = foldTokens(text);
  const out = new Set<string>();
  for (let i = 0; i + 1 < toks.length; i++) {
    const next = toks[i + 1];
    if (!/^[a-z]+$/.test(next)) continue;
    if (/^\d+$/.test(toks[i])) out.add(`${toks[i]} ${stemOf(next)}`);
    else if (Object.prototype.hasOwnProperty.call(NUMBER_WORDS, toks[i]) && isUnitWord(next)) out.add(`${NUMBER_WORDS[toks[i]]} ${stemOf(next)}`);
  }
  return out;
}

/** Content words two examples may share before they are about the same CASE (one food is vocabulary). */
export const CONTENT_SHARED_MAX = 1;

/** Prompt texts (few-shot messages, quotes) sharing more than CONTENT_SHARED_MAX content stems with a fixture text. */
export function contentOverlaps(probes: readonly TextCase[], fixtures: readonly TextCase[], max = CONTENT_SHARED_MAX): Overlap[] {
  const out: Overlap[] = [];
  const fx = fixtures.map((f) => ({ id: f.id, stems: contentStems(f.text) }));
  for (const p of probes) {
    const ps = contentStems(p.text);
    for (const f of fx) {
      const shared = [...ps].filter((s) => f.stems.has(s));
      if (shared.length > max) out.push({ probe: p.id, fixture: f.id, why: `ortak içerik kelimeleri: ${shared.join(', ')}` });
    }
  }
  return out;
}

/** Prompt texts reusing a fixture's number+word pair ("2 dilim", "2 degil"). */
export function numberUnitOverlaps(probes: readonly TextCase[], fixtures: readonly TextCase[]): Overlap[] {
  const out: Overlap[] = [];
  const fx = fixtures.map((f) => ({ id: f.id, pairs: numberUnitPairs(f.text) }));
  for (const p of probes) {
    const pp = numberUnitPairs(p.text);
    for (const f of fx) {
      const shared = [...pp].filter((x) => f.pairs.has(x));
      if (shared.length) out.push({ probe: p.id, fixture: f.id, why: `ortak sayı+birim: ${shared.join(', ')}` });
    }
  }
  return out;
}

/**
 * A tripwire question (shared/safety-tripwires.ts question_tr, read by Stage A as a fact on the turn
 * it fires) against the message it fired on: the content stems both share BEYOND the words that
 * fired it (`matched` — the trigger is in both by construction). More than CONTENT_SHARED_MAX means
 * the question describes that case, not the two readings (review of tuning round 3: the yutamıyorum
 * question echoed the B+ fixture written with it — "boğaz", "takıl").
 */
export function questionEcho(question: string, matched: string, message: string): string[] {
  const trigger = contentStems(matched);
  const msg = contentStems(message);
  return [...contentStems(question)].filter((s) => msg.has(s) && !trigger.has(s));
}

/** The examples a capability text gives: "(ör. …)" asides and "…" quotes (the coach reads both). */
export function capabilityExamples(text: string): string[] {
  const asides = [...text.matchAll(/\((?:ör|örn)\.?\s*([^)]*)\)/gu)].map((m) => m[1].trim()).filter((s) => s !== '');
  return [...asides, ...quotedPhrases(text)];
}

/** `KAYITLAR: m12 · …` → { ref: 'm12', line: '…' } (the first token after the label is the ref). */
export function contextRefLine(line: string): { ref: string; line: string } | null {
  const colon = line.indexOf(': ');
  if (colon < 0) return null;
  const rest = line.slice(colon + 2);
  const m = /^([a-z]{1,3}\d+) · (.*)$/.exec(rest);
  return m ? { ref: m[1], line: m[2] } : null;
}
