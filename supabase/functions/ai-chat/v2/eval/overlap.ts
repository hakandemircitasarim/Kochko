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
 *   · a few-shot context line with a fixture's ref AND a shared food word on that ref's line.
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

/** `KAYITLAR: m12 · …` → { ref: 'm12', line: '…' } (the first token after the label is the ref). */
export function contextRefLine(line: string): { ref: string; line: string } | null {
  const colon = line.indexOf(': ');
  if (colon < 0) return null;
  const rest = line.slice(colon + 2);
  const m = /^([a-z]{1,3}\d+) · (.*)$/.exec(rest);
  return m ? { ref: m[1], line: m[2] } : null;
}
