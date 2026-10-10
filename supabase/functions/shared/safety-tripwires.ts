/**
 * SAFETY TRIPWIRES — AI_MIMARI_V2 §3.2 T2 · §7.1 · §7.2 · §7.4.
 *
 * THE ONLY PLACE where code runs regex over the USER's text (§2 rule 2). Everything here is a
 * safety trigger, never an interpretation: a hit either answers instantly (explicit list) or hands
 * Stage A a FACT it must read and justify (ambiguous list). Writes, intents and amounts are never
 * derived from these patterns.
 *
 *   EXPLICIT   → the canned reply below, instantly, no LLM (today's behaviour, sen-voice, 112).
 *              Two parts: the CURATED patterns (intihar, kendimi öldürmek, nefes alamıyorum,
 *              göğsüm sıkışıyor… — the user, now, in more spellings and inflections than v1 knew)
 *              and the V1 FLOOR: every message v1's detectEmergency/detectCrisis answers
 *              instantly is answered instantly here too (§7.1, §7.4 — see V1_FLOOR_TRIPWIRES) —
 *              except the phrases the spec itself puts on the AMBIGUOUS list (below).
 *   AMBIGUOUS  (bayıldım, tükendim, kalp çarpıntısı, bayılacak gibiyim, nefesim daralıyor, keşke
 *              uyanmasam, kustum, aç kalma…) → a tripwire fact for Stage A (+ a parallel classifier
 *              for emergency/self-harm). resolveTripwires() applies the §7.2 table, PROTECTIVE BY
 *              DEFAULT: without a qualifying benign reading the protective path runs; Stage A
 *              timeout/error/refusal → today's canned reply (fail-closed). A benign reading lifts
 *              protection only behind the B+ gate (`benignOverride`, default off) and, for
 *              emergency/self-harm, only with the classifier's independent benign (§7.4.1).
 *   SIGNAL     (alerji / sakatlık beyanı) → a fact only: "Stage A wrote no constraint — why?"
 *   INJECTION  → logged, never refused (§7.3).
 *
 * Why a split instead of today's single list: every v1 hit is an instant canned reply, so
 * "bu tarife bayıldım" gets 112 and "dün gece kustum, zehirlendim galiba" an ED referral plus a
 * 14-day deficit lock. The CURATED list keeps only phrasings with no plausible benign reading,
 * about the user, NOW: the same words told as past or about someone else ("koşuda nefes
 * alamıyordum, normal mi?") are reported as an ambiguous `<id>.anlatim` hit (see `narration`),
 * and a curated pattern never reaches into a neighbouring word ("hayatımı son derece
 * kolaylaştırdı" is praise, not "hayatıma son"). A simile is NOT narration: "sanki kalp krizi
 * geçiriyormuşum gibi", "göğsüm sıkışıyormuş gibi" is how Turkish describes a symptom happening
 * now (wave-2a review) — and no "… gibi değil" denial heuristic exists here on purpose: one that
 * read any negative verb after "gibi" demoted real emergencies (rejected, d1fd68b SIMILE_DENIED).
 *
 * THE V1 FLOOR. Demoting a phrase v1 answers instantly (bare "kalp krizi", "felç", "kan küstüm",
 * "yutamıyorum", "nefesim kesildi", "ben bittim", "hayata veda", "babam … göğüs ağrısı vardı" …)
 * to Stage A removes an instant block, and §7.4 needs owner approval AND shadow evidence for that
 * — which we do not have. So until then v1's own lists and root regexes run as the LAST explicit
 * tier: a curated pattern still names the words first, and a curated ambiguous reading of the same
 * words (emg.kalp_krizi, `<id>.anlatim` …) is still recorded next to the floor hit — ledger
 * evidence for that future decision — but the outcome is instant.
 * The one exception is the spec's own AMBIGUOUS list (§3.2 T2, §7.2: "bayıldım, tükendim, kustum,
 * kalp çarpıntısı, aç kalma…" — V1_AMBIGUOUS_PHRASES; "kustum"/"aç kalma" are ED, ambiguous in v2
 * anyway): v1 over-fires on exactly these ("bu tarife bayıldım" → 112, §1), and §7.4.1 already
 * says how they stay protected — "her hit ya korumayı uygular ya da iki bağımsız benign okuma
 * ister". They are ambiguous hits, PROTECTIVE BY DEFAULT: with the override gate off (production
 * today) every one of them ends in the protective path or, when Stage A fails, in today's canned
 * reply — never in a normal turn. The golden parity test in safety-tripwires.test.ts holds this
 * over a broad Turkish corpus: v1 instant ⇒ v2 explicit, or an ambiguous-list hit that resolves
 * protective without a qualifying benign reading.
 * v1's lists and regexes live here (guardrails.ts imports them — a pure move, v1 behaviour
 * unchanged); editing a V1_* list changes v1 too. Rules for editing (§7.4): ADDING a pattern
 * ships any time; a curated pattern may be narrowed (an `.anlatim` reading) with a review and a
 * golden test, never below v1 — only where v1 is silent, since the floor answers the rest; moving
 * anything out of the floor, or adding a phrase to V1_AMBIGUOUS_PHRASES, needs owner approval,
 * shadow evidence and 100% recall on the golden positive set.
 *
 * Matching: the message is NFC-normalised, tr-lowercased, apostrophes dropped, whitespace
 * collapsed, then diacritic-folded (ş→s, ı→i, ğ→g …), so a curated pattern covers both "ölmek
 * istiyorum" and "olmek istiyorum". Word starts use (?<!\p{L}) — JS \b only knows ASCII letters.
 * A few patterns run on the unfolded lowercase text instead: v1's regexes (their v1 semantics)
 * and "kendimi as…", because folding would merge "aşmak" (exceed) into "asmak" (hang). The floor
 * finally runs v1 verbatim on the RAW text (v1VerbatimMatch, the backstop in scanTripwires), so no
 * normalisation step can make v2 miss what v1 answers.
 *
 * Pure: no I/O, no Deno/npm imports (the eval runner and any runtime can load it).
 */

export const TRIPWIRES_VERSION = 'tw-2026-10-10b';

// ─── types ───────────────────────────────────────────────────────────────────

export type SafetyCategory = 'emergency' | 'self_harm' | 'ed';
export type TripwireCategory = SafetyCategory | 'declaration';
export type TripwireTier = 'explicit' | 'ambiguous' | 'signal';
export type EdSeverity = 'high' | 'medium';

export interface TripwireHit {
  /** Per-scan handle Stage A answers with in `safety.tripwire_readings[].hit_id` ('tw1', 'tw2', …). */
  hit_id: string;
  /** Stable pattern id for the ledger ('emg.bayilma', 'sh.intihar', 'ed.kusma' …); a curated
   * explicit phrasing told as past, about someone else or denied is '<explicit id>.anlatim' (tier
   * 'ambiguous'); a hit only the v1 floor makes instant is one of V1_FLOOR_TRIGGERS; a v1
   * ambiguous-list phrase no curated pattern recognised is one of V1_AMBIGUOUS_FLOOR_TRIGGERS. */
  trigger: string;
  category: TripwireCategory;
  tier: TripwireTier;
  /** The matched span in the user's own spelling (NFC). */
  matched: string;
  /** ±40-character window around the match, user's spelling — for triage logs only. */
  context: string;
  /** ED only: a same-clause refusal follows ("aç kalmak istemiyorum"). Today's detector ignores
   * such hits; here they still reach Stage A as a fact but never trigger the canned fallback. */
  negated: boolean;
  /** ED only: today's severity (high → canned referral, medium → appended referral). */
  ed_severity: EdSeverity | null;
  /** What Stage A has to decide about this hit (Turkish, for its prompt). */
  question_tr: string;
}

export interface InjectionHit {
  pattern: string;
  /** v1 still refuses on this pattern (guardrails.sanitizeUserInput); v2 only logs it. */
  refused_in_v1: boolean;
}

/**
 * What v1 (guardrails.detectEmergency / detectCrisis, verbatim on the raw text) does with the
 * message, per category: null = silent; 'explicit' = it fires through a phrase or root regex v2
 * keeps explicit; 'ambiguous' = it fires ONLY through the spec's ambiguous-list phrases
 * (V1_AMBIGUOUS_PHRASES) — v2 then holds a live ambiguous hit that is protective by default.
 */
export type V1Verdict = 'explicit' | 'ambiguous' | null;
export interface V1Verdicts { emergency: V1Verdict; self_harm: V1Verdict }

export interface TripwireScan {
  /** The explicit hit that decides the canned reply (emergency before self-harm, as v1); a
   * curated hit wins over a floor hit of the same category. */
  explicit: TripwireHit | null;
  /** Every hit: curated explicit, ambiguous (curated, then v1's ambiguous-list phrases), signal,
   * then the v1 floor — each tier in list then text order. */
  hits: TripwireHit[];
  injection: InjectionHit[];
  /** v1's own verdict on this message (§7.4 parity, ledger evidence for a future demotion). */
  v1: V1Verdicts;
}

export interface Span { index: number; length: number }

export interface TripwireDef {
  id: string;
  category: TripwireCategory;
  tier: TripwireTier;
  /** Run on the folded text (default) or on the unfolded lowercase text. */
  on?: 'folded' | 'lower';
  re?: RegExp;
  /** For rules that are not a single pattern (v1 phrase lists, low-calorie intent): every
   * occurrence in the text selected by `on` (`dotted` = the ı→i pass of the lowercase text). */
  find?: (text: string, pass: 'folded' | 'lower' | 'dotted') => Span[];
  ed_severity?: EdSeverity;
  /** ED: a same-clause refusal after the match marks the hit negated (v1 F2/A8 rule). */
  negatable?: boolean;
  /**
   * CURATED EXPLICIT only — is this occurrence past narration, someone else's, or denied? Gets the
   * folded last word of the match (completed to its end), the word right after it, the folded
   * text right after it (up to 60 characters; '' when punctuation, not a space, follows the word)
   * and, in `ctx`, the folded text before the match (up to 80 characters) and everything after
   * the word to the END of the message.
   * True → the occurrence is reported as an AMBIGUOUS hit with trigger `<id>.anlatim`: Stage A
   * reads it, no qualifying benign reading → protective path, a failed Stage A still gives today's
   * canned reply. It never lowers v1: when v1 answers the message instantly, the v1 floor still
   * makes it explicit.
   */
  narration?: (verb: string, next: string, after: string, ctx: NarrationContext) => boolean;
  /** Stage A's question for a narrated occurrence (default: `question_tr`). */
  narration_q?: string;
  question_tr: string;
}

export interface NarrationContext {
  /** Folded text right before the match (up to 80 characters). */
  before: string;
  /** Folded text after the matched word, to the end of the message (punctuation included). */
  tail: string;
}

// ─── normalisation ───────────────────────────────────────────────────────────

const APOSTROPHES = new Set(["'", '’', '‘', '`', '´', 'ʼ']);

interface Texts {
  src: string;
  lower: string;
  /** `lower` with ı→i: ASCII capitals typed on a non-Turkish keyboard ("KENDIMI") tr-lowercase
   * to "kendımı", which v1's regexes (and v1 itself) never matched. */
  lowerDotted: string;
  folded: string;
  map: number[];
}

/**
 * One pass that yields the lowercase and the folded text with the SAME length, plus a map from
 * every folded position back to the NFC source, so a hit can be quoted in the user's spelling.
 */
function buildTexts(input: string): Texts {
  const src = (input ?? '').normalize('NFC');
  // tr-lowercasing is 1:1 for practically every input; lowercase once and index into it, falling
  // back to per-character lowercasing only when some character changed length.
  const lcAll = src.toLocaleLowerCase('tr');
  const sameLength = lcAll.length === src.length;
  let lower = '';
  let folded = '';
  const map: number[] = [];
  let lastWasSpace = true;
  for (let i = 0; i < src.length;) {
    const ch = String.fromCodePoint(src.codePointAt(i)!);
    const width = ch.length;
    if (APOSTROPHES.has(ch)) { i += width; continue; }
    if (/\s/u.test(ch)) {
      if (!lastWasSpace) { lower += ' '; folded += ' '; map.push(i); lastWasSpace = true; }
      i += width;
      continue;
    }
    const lc = sameLength ? lcAll.slice(i, i + width) : ch.toLocaleLowerCase('tr');
    const fd = lc.normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/g, 'i');
    const lw = fd.length === lc.length ? lc : fd;
    for (let k = 0; k < fd.length; k++) map.push(i);
    lower += lw;
    folded += fd;
    lastWasSpace = false;
    i += width;
  }
  return { src, lower, lowerDotted: lower.replace(/ı/g, 'i'), folded, map };
}

/** The folded form the patterns run on — also the right key for Stage A's verbatim-quote check. */
export function foldTripwireText(text: string): string {
  return buildTexts(text).folded.trim();
}

function originalSlice(t: Texts, from: number, toExclusive: number): string {
  if (t.map.length === 0 || toExclusive <= from) return '';
  const a = t.map[Math.max(0, from)];
  const lastIdx = Math.min(t.map.length - 1, toExclusive - 1);
  const b = t.map[lastIdx];
  const width = String.fromCodePoint(t.src.codePointAt(b)!).length;
  return t.src.slice(a, b + width).trim();
}

// ─── ED negation (v1's rule, v1's regexes, v1's window) ──────────────────────
// Moved here verbatim from guardrails.detectEDRisk (which imports them back — a pure move).
// A negated hit gets no canned fallback, so negation must never reach further than v1's: the
// window is the 30 SOURCE characters after the match on the tr-lowercased raw text, exactly as v1
// measures it — collapsed whitespace and dropped apostrophes cannot pull a refusal into reach, and
// a refusal v1 cannot read ("ISTEMIYORUM" → "ıstemıyorum") cancels nothing here either.

/** guardrails.detectEDRisk refusal regex (F2/A8), on the tr-lowercased raw text. */
export const V1_ED_NEGATED = /(istemiyorum|istemem|yapm[ıi]yorum|yapmam|kullanm[ıi]yorum|kullanmam|etmiyorum|etmem|de[gğ]ilim|hi[çc] olmad|asla)/;
/** guardrails.detectEDRisk clause break: a comma or a contrast word ends the refusal's reach. */
export const V1_CLAUSE_BREAK = /(,|(?<![\p{L}\p{N}_])(?:ama|fakat|ancak|yine de)(?![\p{L}\p{N}_]))/u;

/** `end` is a folded index (exclusive end of the match). */
function negatedAfter(t: Texts, end: number): boolean {
  if (end <= 0 || t.map.length === 0) return false;
  // The source position right after the last matched character (v1: `at + p.length`).
  const last = t.map[Math.min(end, t.map.length) - 1];
  const from = last + String.fromCodePoint(t.src.codePointAt(last)!).length;
  let win = t.src.slice(from, from + 30).toLocaleLowerCase('tr');
  const brk = win.search(V1_CLAUSE_BREAK);
  if (brk >= 0) win = win.slice(0, brk);
  return V1_ED_NEGATED.test(win);
}

// ─── narration (explicit list only) ──────────────────────────────────────────

/** Past narration on the matched verb word (folded): -iyordu/-iyodu (was …-ing), -mıştı (had …),
 * -ardı/-irdi/-urdu (used to). Simple past stays instant: for these state verbs it reports a state
 * that holds now ("sol kolum uyuştu" = it is numb now).
 * NOT -iyormuş (wave-2a review): "sanki kalp krizi geçiriyormuşum gibi", "kalp krizi geçiriyormuş
 * gibiyim", "göğsüm ağrıyormuş gibi" describe an acute symptom NOW, and "babam kalp krizi
 * geçiriyormuş" reports one happening now — v1 answers all of them instantly. Only an explicitly
 * past form demotes it: -iyormuştu (PAST_VERB) or "… gibiydi(m)" (PAST_AUX). */
const PAST_VERB = /(?:yor?du|m[iu]st[iu]|[aeiu]rd[iu])/u;
/** A past auxiliary right after the matched phrase ("göğsümde ağrı vardı", "… geçiriyormuş gibiydim"). */
const PAST_AUX = /^(?:vardi|yoktu|oluyordu|olmustu|olurdu|gibiydi)/u;
const pastNarration = (verb: string, next: string): boolean => PAST_VERB.test(verb) || PAST_AUX.test(next);

/** A first-person simile on an -iyormuş verb — the user's own symptom, now: "…-iyormuşum gibi",
 * "…-iyormuş gibiyim", "…-iyormuş gibi hissediyorum / oluyorum". Not "…-iyormuş gibiydim" (past). */
const firstPersonSimile = (verb: string, after: string): boolean =>
  /yor?mus(?:um)?$/u.test(verb) && (
    (/musum$/u.test(verb) && /^gibi(?!\p{L})/u.test(after)) ||
    /^gibiyim(?!\p{L})/u.test(after) ||
    /^gibi \p{L}+yo(?:ru)?m+(?!\p{L})/u.test(after));

/** Breathing is instant only for the user, now: the present first person ("alamıyorum",
 * "alamıyom") or a first-person simile ("alamıyormuşum gibi", "alamıyormuş gibiyim"). "alamıyor",
 * "alamıyoruz", "alamıyorsun", "alamıyordum" are someone else's or past (wave-1 review), and so is
 * a bare "alamıyormuşum" ("uykuda nefes alamıyormuşum" = what a sleep test found). */
const notMeNow = (verb: string, _next: string, after: string): boolean =>
  !(/yo(?:ru)?m+$/u.test(verb) || firstPersonSimile(verb, after));

/** "hayata veda etti / etmiş / eden / ettiğinde": a death being told, not an intent. */
const someoneElsesDeath = (_verb: string, next: string): boolean =>
  /^(?:etti(?!m)|etmis(?!im)|eden|ettig|ettikt|ettiler|etmisler)/u.test(next);

/** An infinitive hands the person to the next word: "son vermek İSTİYORUM", "vermeyi DÜŞÜNÜYORUM". */
const INTENT_INFINITIVE = /m[ae](?:k|yi|ye)?$/u;
/** The verbs a sh.hayatima_son phrasing ends in: its own (ver, koy, bitir, sonlandır) or the
 * auxiliary after the infinitive (iste, düşün, planla). Folded spelling. */
const INTENT_STEM = '(?:iste|isti|ist|dusun|planla|planli|ver|sonver|koy|bitir|sonlandir)';
/** A negated form of one of those verbs: -mıyor, -meyecek, -medi, -memiş, -mez. Not "-mem"
 * ("son vermem gerek" = I must end it) and never any other verb ("umuyorum" = I hope). */
const INTENT_DENIED = new RegExp(`^${INTENT_STEM}m(?:[iu]yo|[ae]y[ae]c|[ae]d[iu]|[ae]m[iu]s|[ae]z)`, 'u');
/** The tense of a finite form: -iyor/-iyo, -ecek, -di, -miş, aorist -er/-ir. */
const INTENT_TENSE = '(?:yo(?:r)?|[ae]c[ae]k|[dt][iu]|m[iu]s|[aeiu]r)';
/** 2nd person — the person is in the ending itself: istiyorsun, istersin, verdin, istiyon,
 * verdiniz. Never a plea ("son ver", "son versin": no tense before the ending). */
const INTENT_SECOND = new RegExp(`^${INTENT_STEM}\\p{L}*?${INTENT_TENSE}(?:s[iu]n(?:[iu]z)?|n(?:[iu]z)?)$`, 'u');
/** 3rd person plural — also in the ending: istiyorlar, istiyolar, verecekler, isterler. */
const INTENT_THIRD_PLURAL = new RegExp(`^${INTENT_STEM}\\p{L}*?${INTENT_TENSE}l[ae]r$`, 'u');
/** A bare tense with no person ending: istiyor, istiyo, verecek, verdi, vermiş, ister. Third
 * person singular — or a first person typed short ("hayatımı sonlandırmak istiyo"), which is why
 * it narrows only with an explicit other subject (otherSubjectBefore). */
const INTENT_THIRD = new RegExp(`^${INTENT_STEM}\\p{L}*?${INTENT_TENSE}$`, 'u');

/** Third-person pronouns that can only be the subject when they stand right before the object
 * ("o hayatımı …", "onlar hayatıma …"). Not "bu/şu": "bu hayatıma son vermek istiyo" is "this life
 * of mine". */
const OTHER_PRONOUN = /^(?:o|onlar|biri|birisi|birileri|herkes|kimse|insanlar)$/u;
/** Possessed person nouns ("patronum", "annem", "eşim", "kocası" …), closed list, folded. Never a
 * word Turkish also uses to ADDRESS someone ("hocam", "abi", "abla", "kardeşim", "kızım", "canım"):
 * "hocam hayatımı sonlandırmak istiyo" is the user talking to the coach. */
const OTHER_PERSON_NOUN = new RegExp(
  '^(?:patron|mudur|amir|sef|anne|baba|es|koca|kari|sevgili|nisanli|dede|nine|babaanne|anneanne|teyze|hala|amca|dayi|yenge|kuzen|komsu|kaynana|kayinvalide|kayinpeder|arkadas|aile)' +
    '(?:ler|lar)?(?:im|um|m|imiz|umuz|miz|si|i|u|leri|lari)$', 'u');
/**
 * An explicit subject that is not the user, in the clause right before "hayatımı/hayatıma": a
 * pronoun right before it, or a possessed person noun within the last two words ("patronum resmen
 * hayatımı …"). An unknown word is not a subject — when unsure, explicit.
 */
function otherSubjectBefore(before: string): boolean {
  const clause = before.split(/[.,;:!?…]/u).pop() ?? '';
  const words = clause.split(' ').filter((w) => /^\p{L}+$/u.test(w));
  const last = words[words.length - 1] ?? '';
  const prev = words[words.length - 2] ?? '';
  return OTHER_PRONOUN.test(last) || OTHER_PERSON_NOUN.test(last) || OTHER_PERSON_NOUN.test(prev);
}

/** Nothing but non-letters to the END of the message: no further clause or sentence follows. */
const endsMessage = (rest: string): boolean => !/\p{L}/u.test(rest);

/**
 * sh.hayatima_son is an INTENT; it is not the user's own when the person-bearing word is clearly
 * someone else's or denied AND is the message's last word: "hayatımı sonlandırmak istemiyorum",
 * "hayatımı sonlandırmak istiyorsun", "onlar … istiyorlar", "patronum hayatımı sonlandırmak
 * istiyor". Everything else stays instant (parity review, 95e766c):
 *  - anything after it — "… istemiyorum. ama çarem yok" is a denial with a crisis continuation;
 *  - a bare third-person form with no explicit other subject — "hayatımı sonlandırmak istiyo",
 *    "hayatımı sonlandırıyo", "… düşünüyo" are as likely the user typing short;
 *  - the first person, a bare "hayatıma son", a plea ("Allah'ım hayatıma son ver"), a question
 *    ("istiyor muyum"), a simile ("istiyor gibiyim"), an unknown word: when unsure, explicit.
 * v1 answers most of these phrasings instantly anyway (phrase "hayatıma son", root "hayatımı …
 * bitir"), and then the v1 floor keeps them instant; this only stops the intent pattern from
 * claiming them.
 */
const notMyIntent = (verb: string, _next: string, _after: string, ctx: NarrationContext): boolean => {
  let word = verb;
  let rest = ctx.tail;
  if (INTENT_INFINITIVE.test(verb)) {
    // "son vermek İSTİYORUM": the person is on the auxiliary, the next word.
    const aux = /^ (\p{L}+)/u.exec(ctx.tail);
    if (!aux) return false;
    word = aux[1];
    rest = ctx.tail.slice(aux[0].length);
  }
  if (!endsMessage(rest)) return false;
  if (INTENT_DENIED.test(word)) return true;
  if (/m$/u.test(word)) return false; // every Turkish 1sg ending ends in -m
  if (INTENT_SECOND.test(word) || INTENT_THIRD_PLURAL.test(word)) return true;
  return INTENT_THIRD.test(word) && otherSubjectBefore(ctx.before);
};

/**
 * v1's dangerously-low calorie INTENT rule (#live-L7 / AI-GRD-02), copied verbatim from
 * guardrails.detectEDRisk and run on the same lowercase text: a 2–4 digit kcal figure under 1100
 * in an eating context, not a deficit, not a past-tense log. Number reading is allowed here only
 * because it is a safety trigger, never a write.
 */
function lowKcalIntent(lower: string, pass: 'folded' | 'lower' | 'dotted'): Span[] {
  const m = /(\d{2,4})\s*(kalori|kcal|kal\b|cal\b)/.exec(lower);
  if (!m) return [];
  // The dotted pass turned the user's "açık" into "açik"; it is still a deficit, not intake.
  if ((pass === 'dotted' ? /(açık|acik|açik|defisit|yak|harca)/ : /(açık|acik|defisit|yak|harca)/).test(lower)) return [];
  const kcal = parseInt(m[1], 10);
  const reported = /(yedim|yedik|i[çc]tim|ald[ıi]m|t[üu]kettim|yemi[şs]tim|kald[ıi]|olmu[şs])/.test(lower);
  const intent = /(istiyorum|isterim|yiyece[gğ]im|hedef|plan|niyet|ç[ıi]kaca[gğ][ıi]m|inece[gğ]im|yapaca[gğ][ıi]m)/.test(lower);
  const eating = /(ye|yiyor|yedim|yiyom|yicem|yicek|öğün|ogun|yi?yec|yemek|alaca|alıyor|aliyor|gün(de)?|gun(de)?|diyet|beslen|tüket|tuket)/.test(lower);
  if (kcal > 0 && kcal < 1100 && eating && !(reported && !intent)) return [{ index: m.index, length: m[0].length }];
  return [];
}

/** Every occurrence of any phrase (folded) — the v1 phrase lists' substring semantics. */
function phraseFinder(phrases: readonly string[]): (text: string) => Span[] {
  const folded = [...new Set(phrases.map((p) => buildTexts(p).folded.trim()))].filter(Boolean);
  return (text) => {
    const out: Span[] = [];
    for (const p of folded) {
      for (let i = text.indexOf(p); i >= 0; i = text.indexOf(p, i + 1)) out.push({ index: i, length: p.length });
    }
    return out.sort((a, b) => a.index - b.index);
  };
}

// ─── v1's lists, moved here verbatim (guardrails.ts imports them; behaviour unchanged) ──────
// They also back the catch-all ambiguous triggers below, which makes "every v1 hit is still a
// hit" true by construction (§7.4.1). Folding only merges spellings, so a folded substring search
// finds everything v1's lowercase includes() found.

/** guardrails.detectEmergency phrase list. */
export const V1_EMERGENCY_PHRASES: readonly string[] = [
  'gogus agrisi', 'göğüs ağrısı', 'gogsum agriyor', 'göğsüm ağrıyor',
  'nefes alamıyorum', 'nefes alamiyorum', 'nefesim kesildi', 'nefesim yok',
  'bayiliyorum', 'bayılıyorum', 'bayildim', 'bayıldım',
  'kalp krizi', 'felc', 'felç',
  'kan kusuyorum', 'kan kusdum', 'kan küstüm',
  'bilincimi kaybediyorum', 'bilincim kapaniyor', 'bilincim kapanıyor',
  'cok siddetli agri', 'çok şiddetli ağrı', 'dayanilmaz agri', 'dayanılmaz ağrı',
  'kalp çarpıntısı', 'kalp carpintisi',
  'sol kolum uyusuyor', 'sol kolum uyuşuyor',
  'yutamiyorum', 'yutamıyorum',
  'gorme kaybı', 'gorme kaybi', 'göremiyorum', 'goremiyorum',
];

/** guardrails.detectCrisis phrase list. */
export const V1_CRISIS_PHRASES: readonly string[] = [
  'kendime zarar', 'kendime zarar vermek',
  'intihar', 'intihar etmek', 'intihar etmeyi',
  'olmek istiyorum', 'ölmek istiyorum', 'artik yasamak istemiyorum', 'artık yaşamak istemiyorum',
  'yasamak istemiyorum', 'yaşamak istemiyorum',
  'canima kiymak', 'canıma kıymak', 'canima kiyacagim', 'canıma kıyacağım',
  'hayatima son', 'hayatıma son', 'yasamima son', 'yaşamıma son',
  'kendimi oldurmek', 'kendimi öldürmek', 'kendimi olduregim', 'kendimi öldüreceğim',
  // FIX (audit guardrails_crisis): common despair / "I'm finished" idioms the literal
  // list missed. These read as acute crisis and must trigger the 112 + professional
  // response, never the milder ED referral.
  'bittim ben', 'ben bittim', 'tukendim', 'tükendim',
  'kendime kiymak', 'kendime kıymak', 'kendime kiyacagim', 'kendime kıyacağım',
  'hayata veda', 'her seye son ver', 'her şeye son ver',
  'olup kurtul', 'ölüp kurtul', 'yok olmak isti',
];

/**
 * guardrails.detectCrisis root regexes (run on the tr-lowercased message). History kept from v1:
 * FIX (audit regression): roots were bare substrings → false-positives ('kestane'⊃kes,
 * 'kıyma'⊃kıy, 'asansör'⊃as[a], 'doldur'⊃oldur). Constrain each to real self-harm verb
 * conjugations while preserving crisis recall (kıydım/astım/keseceğim still fire).
 * FIX (audit AI-GRD-01/CRITICAL): mastar/ulaç biçimleri eklendi — "kendimi asmak/asmayı/asmaya",
 * "kendimi kesmek/kesmeyi"; the self-harm subject (kendimi/canımı/hayatımı) must sit within 30
 * characters, so "asma katı"/"asma (üzüm)" do not fire.
 */
export const V1_CRISIS_PATTERNS: readonly RegExp[] = [
  /(kendi(mi|me)|canı(mı|ma)|cani(mi|ma)|hayatı(mı|ma)|hayati(mi|ma)|yaşamı(mı|ma)|yasami(mi|ma)|her\s*şeye|her\s*seye).{0,30}(as(acağ|acak|tım|tim|arak|ıyor|iyor|mak|may|maya)|kes(ece|ece[kğ]|eceğ|erim|iyor|tim|tım|mek|meyi|meye)|kıy(mak|acağ|acak|dım|dim|dı|arım|arim|amam)|kiy(mak|acag|acak|dim|di|arim|amam)|son\s*ver|öldür|oldur|\boldur(mek|ece|eyim)|bitir(mek|ece|di|eyim)|veda|yok\s*et)/u,
  /(ölüp\s*kurtul|olup\s*kurtul|hayata\s*veda|son\s*vermek\s*isti|yaşamak\s*istemiyorum|yasamak\s*istemiyorum|yok\s*olmak\s*isti)/u,
  /(bilek|damar|bileği?mi|bilegimi).{0,15}(kes)/u,
  /(ip|bıçak|bicak|hap).{0,15}(kendi|canı|cani)/u,
];

/** guardrails.detectEDRisk high-severity phrases (active purging). */
export const V1_ED_HIGH_PHRASES: readonly string[] = [
  'kusma', 'kustum', 'kusuyorum', 'kusmak istiyorum',
  'laksatif', 'müshil', 'mushil',
  'purging', 'binge and purge',
];

/** Past-tense / ongoing evidence: never cancelled by a later refusal ("kustum ama istemiyorum"). */
export const V1_ED_EVIDENCE_PHRASES: readonly string[] = ['kustum', 'kusuyorum'];

/** guardrails.detectEDRisk medium-severity phrases (restriction, body image). */
export const V1_ED_MEDIUM_PHRASES: readonly string[] = [
  'hic yemiyorum', 'hiç yemiyorum', 'hic bir sey yemiyorum', 'hicbir sey yemiyorum', 'hiçbir şey yemiyorum',
  'ac kalma', 'aç kalma', 'ac kalmak istiyorum', 'kendimi ac birakiyorum', 'kendimi aç bırakıyorum',
  'yeme bozukluğu', 'yeme bozuklugu',
  'anoreksiya', 'anorexia', 'bulimiya', 'bulimia',
  'yemek yemekten korkuyorum', 'yemekten nefret',
  'cok sismanim', 'çok şişmanım', 'sisman hissediyorum', 'kilolu hissediyorum',
  'igrenc gorunuyorum', 'iğrenç görünüyorum',
];

// ─── the lists ───────────────────────────────────────────────────────────────
// Folded spelling throughout (ş→s, ı→i, ğ→g, ü→u, ö→o, ç→c). Order inside a tier = priority.

const Q_EMERGENCY = 'Şu an akut bir tıbbi acil durum mu anlatıyor, yoksa geçmişte kalmış ya da mecazi bir kullanım mı?';
const Q_EMERGENCY_NARRATED = 'Şu an süren bir belirti mi, yoksa geçmişte kalmış ya da başkasına ait bir anlatım (ör. "koşuda nefes alamıyordum, normal mi?") mı?';
const Q_SELF_HARM = 'Kendine zarar verme ya da yaşamak istememe düşüncesi mi, yoksa yorgunluk/mecaz mı?';

// Curated explicit = the user, now. Each emergency pattern carries `narration`, so the same words
// told as past or about someone else land in the ambiguous tier as `<id>.anlatim` (never lost) —
// and when v1 answers that message instantly anyway, the v1 floor below keeps it instant. No
// pattern may run into a following word: "hayatımı son derece …", "kendimi zararlı …".
export const EXPLICIT_TRIPWIRES: readonly TripwireDef[] = [
  // ── emergency (acute medical) ──
  { id: 'emg.nefes_alamiyorum', category: 'emergency', tier: 'explicit', re: /(?<!\p{L})(?:nefes|soluk)\s*alami?yo/u, narration: notMeNow, narration_q: Q_EMERGENCY_NARRATED, question_tr: Q_EMERGENCY },
  { id: 'emg.gogus_sikismasi', category: 'emergency', tier: 'explicit', re: /(?<!\p{L})(?:gogus\s+sikis|gogsum\s+(?:cok\s+)?sikis|gogsumde\s+(?:bir\s+|cok\s+)?(?:sikisma|baski))/u, narration: pastNarration, narration_q: Q_EMERGENCY_NARRATED, question_tr: Q_EMERGENCY },
  { id: 'emg.gogus_agrisi', category: 'emergency', tier: 'explicit', re: /(?<!\p{L})(?:gogus\s+agri|gogsum\s+(?:cok\s+)?agri|gogsumde\s+(?:bir\s+|cok\s+)?agri)/u, narration: pastNarration, narration_q: Q_EMERGENCY_NARRATED, question_tr: Q_EMERGENCY },
  // "geçiriyorum / geçiriyormuşum gibi / geçirecek gibiyim / geçirecek gibi hissediyorum": now or
  // about to. Not "geçirecektim", "geçirecek gibiydim" (past) — but v1 answers every "kalp krizi"
  // instantly, so the v1 floor does too until a §7.4 demotion.
  { id: 'emg.kalp_krizi_simdi', category: 'emergency', tier: 'explicit', re: /(?<!\p{L})kalp\s*kriz\p{L}*\s+(?:mi\s+)?gecir(?:iyo|ecek(?:mis)?\s+gibi(?:yim|\s+\p{L}+yo(?:ru)?m))/u, narration: pastNarration, narration_q: Q_EMERGENCY_NARRATED, question_tr: Q_EMERGENCY },
  { id: 'emg.kan_kusuyorum', category: 'emergency', tier: 'explicit', re: /(?<!\p{L})kan\s+kusuyo/u, narration: pastNarration, narration_q: Q_EMERGENCY_NARRATED, question_tr: Q_EMERGENCY },
  { id: 'emg.bilinc_kaybi', category: 'emergency', tier: 'explicit', re: /(?<!\p{L})bilinc\p{L}*\s+(?:kaybed|kaybet|kapan|gidiyo)/u, narration: pastNarration, narration_q: Q_EMERGENCY_NARRATED, question_tr: Q_EMERGENCY },
  { id: 'emg.sol_kol_uyusma', category: 'emergency', tier: 'explicit', re: /(?<!\p{L})sol\s+kol\p{L}*\s+(?:\p{L}+\s+)?uyus/u, narration: pastNarration, narration_q: Q_EMERGENCY_NARRATED, question_tr: Q_EMERGENCY },
  { id: 'emg.felc_simdi', category: 'emergency', tier: 'explicit', re: /(?<!\p{L})felc\s+(?:mi\s+)?gecir(?:iyo|ecek(?:mis)?\s+gibi(?:yim|\s+\p{L}+yo(?:ru)?m))/u, narration: pastNarration, narration_q: Q_EMERGENCY_NARRATED, question_tr: Q_EMERGENCY },
  // ── self-harm / suicide ──
  { id: 'sh.intihar', category: 'self_harm', tier: 'explicit', re: /(?<!\p{L})intihar/u, question_tr: Q_SELF_HARM },
  // Dative only (v1's phrase): the accusative "kendimi zararlı alışkanlıklardan kurtarmak
  // istiyorum" is a goal, and v1 is silent on it. "kendime zararlı bir şey yaptım" stays instant.
  { id: 'sh.kendime_zarar', category: 'self_harm', tier: 'explicit', re: /(?<!\p{L})kendime\s+zarar/u, question_tr: Q_SELF_HARM },
  { id: 'sh.olmek_istiyorum', category: 'self_harm', tier: 'explicit', re: /(?<!\p{L})olmek\s+ist(?:iyo|erdim|edim|erim)/u, question_tr: Q_SELF_HARM },
  // "böyle / bu kiloyla yaşamak istemiyorum" is a common weight-loss sentence, so this pattern does
  // not claim it (sh.yasamak_istemiyorum_nitelikli records the reading) — v1 does, so the floor does.
  { id: 'sh.yasamak_istemiyorum', category: 'self_harm', tier: 'explicit', re: /(?<!\p{L})(?<!(?:boyle|bu sekilde|bu kiloyla|bu kilolarla|bu halde|bu bedenle|bu vucutla) )yasamak\s+ist(?:emiyo|emem)/u, question_tr: Q_SELF_HARM },
  { id: 'sh.canima_kiymak', category: 'self_harm', tier: 'explicit', re: /(?<!\p{L})(?:canima\s+kiy(?:mak|maya|mayi|acag|acak|dim|arim|sam)|kendime\s+kiy(?:mak|acag|acak|dim|arim|sam))/u, question_tr: Q_SELF_HARM },
  // "hayatıma (bir) son ver…" (also typed joined: "sonvereceğim"), "hayatıma son noktayı koy…", a
  // bare "hayatıma son" ending the clause, "hayatımı sonlandır…", first-person "hayatımı bitir…"
  // intent. Never "hayatımı sonsuza dek değiştirdi" / "hayatıma son derece iyi geldi" (praise),
  // nor "bu tatlılar hayatımı bitirecek" (third person: "will ruin my life"); a denied, 2nd
  // person, 3rd plural, or 3rd singular form with an explicit other subject that ends the message
  // is `.anlatim` (notMyIntent). v1 answers "hayatıma son …" and "hayatımı … bitir…" instantly
  // whatever follows, so for those the v1 floor still gives the instant reply.
  { id: 'sh.hayatima_son', category: 'self_harm', tier: 'explicit', re: /(?<!\p{L})(?:hayat|yasam)(?:ima\s+(?:bir\s+)?son(?:\s*ver|\s+nokta\p{L}*\s+koy|(?!\s*\p{L}))|imi\s+(?:sonlandir|bitir(?:ecegim|ecem|mek\s+isti|meyi\s+dusun)))/u, narration: notMyIntent, narration_q: 'Kendi yaşamına son verme niyeti mi, yoksa olumsuzlanmış ya da başkası hakkında bir cümle mi?', question_tr: Q_SELF_HARM },
  // Intent forms only: "antrenmanda kendimi öldürdüm" (gym idiom) is recorded as sh.kendimi_oldurdum
  // and made instant by the v1 floor (v1's root regex). "öldüreğim" is v1's own spelling of the
  // future ("kendimi olduregim" is in V1_CRISIS_PHRASES).
  { id: 'sh.kendimi_oldurmek', category: 'self_harm', tier: 'explicit', re: /(?<!\p{L})kendimi\s+oldur(?:ec|eg|mek|meyi|meye|sem|eyim)/u, question_tr: Q_SELF_HARM },
  // Unfolded: "kendimi aşmak istiyorum" (outdo myself) must not read as "asmak" (hang).
  { id: 'sh.kendimi_asmak', category: 'self_harm', tier: 'explicit', on: 'lower', re: /(?<!\p{L})kendimi\s+as(?:aca[gğ]|acak|mak|may[ıi]|maya|sam|ay[ıi]m)/u, question_tr: Q_SELF_HARM },
  // Unfolded, intent forms only: folding merges "ölüp kurtulmak" with "(zayıf) olup kurtulmak". Both
  // spellings, and the passive wish "ölüp kurtulsam", are v1 phrases, so the v1 floor answers them
  // instantly; sh.olup_kurtul records the reading next to it.
  { id: 'sh.olup_kurtulmak', category: 'self_harm', tier: 'explicit', on: 'lower', re: /(?<!\p{L})ölüp\s+kurtul(?:mak\s+isti|aca[gğ][ıi]m|acam)/u, question_tr: Q_SELF_HARM },
  // First-person object + first-person intent only: "ekmek keserken bileğimi kestim" (an accident)
  // and "bilekliğimi kesmek istiyorum" (a wristband) are left to v1's root regex — the v1 floor.
  { id: 'sh.bilek_kesme_niyeti', category: 'self_harm', tier: 'explicit', re: /(?<!\p{L})(?:bilegimi|bileklerimi|(?:sah\s*)?damar(?:imi|larimi))\s+kes(?:ecegim|ecem|icem|mek\s+isti|meyi\s+dusun)/u, question_tr: Q_SELF_HARM },
  { id: 'sh.hayata_veda', category: 'self_harm', tier: 'explicit', re: /(?<!\p{L})hayata\s+veda/u, narration: someoneElsesDeath, narration_q: 'Kendi yaşamına son verme düşüncesi mi, yoksa başka birinin vefatını mı anlatıyor?', question_tr: Q_SELF_HARM },
  { id: 'sh.her_seye_son', category: 'self_harm', tier: 'explicit', re: /(?<!\p{L})her\s*seye\s+son\s+ver/u, question_tr: Q_SELF_HARM },
  { id: 'sh.yok_olmak', category: 'self_harm', tier: 'explicit', re: /(?<!\p{L})yok\s+olmak\s+isti/u, question_tr: Q_SELF_HARM },
];

export const AMBIGUOUS_TRIPWIRES: readonly TripwireDef[] = [
  // A reading per phrasing. Where v1 answers the message instantly through an explicit-floor
  // phrase ("kalp krizi", "ben bittim" …) the v1 floor decides and these only record what Stage A
  // would be asked (§7.4 evidence); for the spec's ambiguous-list phrases ("bayıldım", "tükendim",
  // "kalp çarpıntısı") and everything v1 is silent on ("bayılacak gibiyim", "nefesim daralıyor")
  // they are the live §7.2 trigger — protective by default.
  // ── emergency ──
  // "bayılırım" (I'd love it) is not even a fact; "bayıldım/bayılıyorum" can be either.
  { id: 'emg.bayilma', category: 'emergency', tier: 'ambiguous', re: /(?<!\p{L})bayil(?!ir(?:im|sin|iz|siniz)(?!\p{L}))/u, question_tr: 'Gerçekten bayılma mı, yoksa "çok beğendim" anlamında mı?' },
  { id: 'emg.nefes_darligi', category: 'emergency', tier: 'ambiguous', re: /(?<!\p{L})nefes\p{L}*\s+(?:kesil|yok|daral|tikan|darl|yetmiyo)/u, question_tr: 'Akut nefes darlığı mı, yoksa efor sonrası normal nefes nefese kalma mı?' },
  // "nefes alamadım / alamayacak gibiyim" (no v1 phrase covers these; an addition).
  { id: 'emg.nefes_alamama', category: 'emergency', tier: 'ambiguous', re: /(?<!\p{L})(?:nefes|soluk)\s*ala(?:madi|mayaca)/u, question_tr: Q_EMERGENCY_NARRATED },
  { id: 'emg.kalp_carpintisi', category: 'emergency', tier: 'ambiguous', re: /(?<!\p{L})(?:(?:kalp\s+)?carpinti|kalbim\s+(?:\p{L}+\s+){0,2}(?:carpiyo|sikis|agri|duracak|tekliyo))/u, question_tr: 'Şu an süren, eşlik eden belirtisi olan bir çarpıntı mı, yoksa geçici/genel bir soru mu?' },
  { id: 'emg.kalp_krizi', category: 'emergency', tier: 'ambiguous', re: /(?<!\p{L})kalp\s*kriz/u, question_tr: 'Şu an yaşanan bir kalp krizi belirtisi mi, yoksa geçmiş/başkası/risk sorusu mu?' },
  { id: 'emg.felc', category: 'emergency', tier: 'ambiguous', re: /(?<!\p{L})felc/u, question_tr: 'Şu an yaşanan bir felç belirtisi mi, yoksa geçmiş/başkası/risk sorusu mu?' },
  { id: 'emg.gogus_genis', category: 'emergency', tier: 'ambiguous', re: /(?<!\p{L})gogu?s\p{L}*\s+(?:\p{L}+\s+)?(?:agri|sikis|baski)/u, question_tr: 'Göğüs ağrısı/sıkışması akut mu, yoksa antrenman sonrası kas ağrısı mı?' },
  { id: 'emg.kan_kusma', category: 'emergency', tier: 'ambiguous', re: /(?<!\p{L})kan\s+kus(?:tum|dum|tu(?!r)|ma)/u, question_tr: 'Gerçekten kan kusma mı, yoksa "çok zorlandım" deyimi mi?' },
  { id: 'emg.yutamiyorum', category: 'emergency', tier: 'ambiguous', re: /(?<!\p{L})(?:yutamiyo|yutkunamiyo)/u, question_tr: 'Yutma güçlüğü (boğazda şişme/tıkanma) mı, yoksa bir yemeği sevmemek mi?' },
  { id: 'emg.gorme_kaybi', category: 'emergency', tier: 'ambiguous', re: /(?<!\p{L})(?:goremiyo|gorme\s+kayb|goz\p{L}*\s+karar)/u, question_tr: 'Ani görme kaybı/kararma mı, yoksa ekrandaki bir yazıyı görememek mi?' },
  { id: 'emg.siddetli_agri', category: 'emergency', tier: 'ambiguous', re: /(?<!\p{L})(?:siddetli|dayanilmaz|cekilmez)\s+(?:bir\s+)?agri/u, question_tr: 'Acil müdahale gerektiren şiddetli bir ağrı mı, yoksa bilinen/hafif bir ağrı mı?' },
  { id: 'emg.anafilaksi_belirti', category: 'emergency', tier: 'ambiguous', re: /(?<!\p{L})(?:anafila(?:ksi|ktik)|(?:bogaz|dil|dudak|yuz)\p{L}*\s+(?:\p{L}+\s+)?(?:sis(?:iyo|ti|mis|me|ik)|kapan))/u, question_tr: 'Şu an süren bir alerjik reaksiyon (şişme, nefes darlığı) mı, yoksa geçmişten/genel bilgi mi?' },
  { id: 'emg.bogulma', category: 'emergency', tier: 'ambiguous', re: /(?<!\p{L})bogul(?:uyo|dum|acag)/u, question_tr: 'Gerçekten boğulma/nefes yolu tıkanması mı, yoksa "bunaldım" anlamında mı?' },
  // ── self-harm ──
  { id: 'sh.tukendim', category: 'self_harm', tier: 'ambiguous', re: /(?<!\p{L})tukendim/u, question_tr: 'Umutsuzluk/kendine zarar düşüncesi mi, yoksa iş/antrenman yorgunluğu mu?' },
  { id: 'sh.bittim', category: 'self_harm', tier: 'ambiguous', re: /(?<!\p{L})(?:ben\s+bittim|bittim\s+ben)/u, question_tr: 'Umutsuzluk mu, yoksa "çok yoruldum" deyimi mi?' },
  { id: 'sh.yasamak_istemiyorum_nitelikli', category: 'self_harm', tier: 'ambiguous', re: /(?<!\p{L})yasamak\s+ist(?:emiyo|emem)/u, question_tr: 'Yaşamak istememe düşüncesi mi, yoksa "böyle yaşamak istemiyorum, değişmek istiyorum" mu?' },
  { id: 'sh.kendimi_oldurdum', category: 'self_harm', tier: 'ambiguous', re: /(?<!\p{L})kendimi\s+oldur/u, question_tr: 'Kendine zarar mı, yoksa "antrenmanda kendimi öldürdüm" deyimi mi?' },
  // Both spellings stay: folding merges "ölüp kurtul" with "zayıf olup kurtulmak".
  { id: 'sh.olup_kurtul', category: 'self_harm', tier: 'ambiguous', re: /(?<!\p{L})olup\s+kurtul/u, question_tr: '"Ölüp kurtulmak" mı, yoksa "(zayıf) olup kurtulmak" mı?' },
  { id: 'sh.pasif_dusunce', category: 'self_harm', tier: 'ambiguous', re: /(?<!\p{L})(?:keske\s+(?:\p{L}+\s+)?(?:uyanmasam|olsem|olseydim|dogmasaydim)|uyanmasam\s+keske|olsem\s+(?:de\s+)?kurtulsam|yasam(?:anin|amin)\s+(?:bir\s+)?anlami\s+(?:yok|kalmadi))/u, question_tr: 'Pasif ölüm/yaşamak istememe düşüncesi mi?' },
  // v1's root regexes are not here: whatever they match, v1 answers instantly → V1_FLOOR_TRIPWIRES.
  // ── eating disorder (all ambiguous: recordEDSignal is fed by Stage A, §7.2) ──
  { id: 'ed.kustum', category: 'ed', tier: 'ambiguous', ed_severity: 'high', re: /(?<!\p{L})kus(?:tum|uyo)/u, question_tr: 'Kilo kontrolü için kusma mı, yoksa hastalık/zehirlenme/gebelik mi?' },
  { id: 'ed.kusma', category: 'ed', tier: 'ambiguous', ed_severity: 'high', negatable: true, re: /(?<!\p{L})kusma/u, question_tr: 'Kilo kontrolü için kusma (isteği) mi, yoksa hastalık ya da reddetme mi?' },
  { id: 'ed.kusturma', category: 'ed', tier: 'ambiguous', ed_severity: 'high', negatable: true, re: /(?<!\p{L})kustur(?:uyo|dum|acag|mak|ma)/u, question_tr: 'Kendini kusturma (çıkarma davranışı) mı?' }, // not "bana kan kusturdu" (idiom)
  { id: 'ed.parmak_bogaz', category: 'ed', tier: 'ambiguous', ed_severity: 'high', negatable: true, re: /(?<!\p{L})parma\p{L}*\s+(?:\p{L}+\s+)?bogaz/u, question_tr: 'Kendini kusturma (çıkarma davranışı) mı?' },
  { id: 'ed.cikarma', category: 'ed', tier: 'ambiguous', ed_severity: 'high', negatable: true, re: /(?<!\p{L})yediklerimi\s+(?:\p{L}+\s+)?(?:cikar|atmak|kusar)/u, question_tr: 'Yediklerini çıkarma (purging) davranışı mı?' },
  { id: 'ed.laksatif', category: 'ed', tier: 'ambiguous', ed_severity: 'high', negatable: true, re: /(?<!\p{L})(?:laksatif|mushil|purging|binge\s+and\s+purge)/u, question_tr: 'Kilo için laksatif/müshil kullanımı mı, yoksa tıbbi kullanım ya da soru mu?' },
  { id: 'ed.dusuk_kalori_niyeti', category: 'ed', tier: 'ambiguous', ed_severity: 'medium', on: 'lower', find: lowKcalIntent, question_tr: 'Günlük alımı tehlikeli düzeyde düşürme niyeti mi, yoksa tek bir öğünün/atıştırmalığın kalorisi mi?' },
  // No word-start on these two: v1 had none, and the folded form already covers its spellings.
  { id: 'ed.hizli_zayiflama', category: 'ed', tier: 'ambiguous', ed_severity: 'medium', re: /(?:(?:cok\s+hizli|hizlica|cabuk|hemen|acilen|bir\s+an\s+once)\s+zayifla|acil(?:en)?\s+kilo\s+ver)/u, question_tr: 'Sağlıksız hızda kilo verme isteği mi?' },
  { id: 'ed.hic_yemiyorum', category: 'ed', tier: 'ambiguous', ed_severity: 'medium', re: /hic\s*(?:bir\s*sey|yemek)?\s*yemiyo/u, question_tr: 'Kısıtlayıcı yeme (hiç yememe) mi, yoksa belirli bir yiyeceği yememe mi?' },
  { id: 'ed.ac_kalma', category: 'ed', tier: 'ambiguous', ed_severity: 'medium', negatable: true, re: /(?<!\p{L})ac\s+kalma/u, question_tr: 'Aç kalma niyeti mi, yoksa "aç kalmadan" kilo verme sorusu mu?' },
  { id: 'ed.ac_birakma', category: 'ed', tier: 'ambiguous', ed_severity: 'medium', negatable: true, re: /(?<!\p{L})kendimi\s+ac\s+birak/u, question_tr: 'Kendini aç bırakma davranışı mı?' },
  { id: 'ed.teshis_adi', category: 'ed', tier: 'ambiguous', ed_severity: 'medium', negatable: true, re: /(?<!\p{L})(?:yeme\s+bozuklu|anorek|anorex|bulimi)/u, question_tr: 'Kendisiyle ilgili bir yeme bozukluğu bildirimi mi, yoksa genel bilgi sorusu mu?' },
  { id: 'ed.yemek_korkusu', category: 'ed', tier: 'ambiguous', ed_severity: 'medium', negatable: true, re: /(?<!\p{L})(?:yemek\s+yemekten\s+kork|yemekten\s+nefret)/u, question_tr: 'Yemekle ilgili korku/nefret (YB sinyali) mi?' },
  { id: 'ed.beden_algisi', category: 'ed', tier: 'ambiguous', ed_severity: 'medium', negatable: true, re: /(?<!\p{L})(?:cok\s+sismanim|sisman\s+hissed|kilolu\s+hissed|igrenc\s+gorunuyo)/u, question_tr: 'Olumsuz beden algısı (YB sinyali) mi, yoksa sıradan bir ifade mi?' },
  { id: 'ed.sadece_su', category: 'ed', tier: 'ambiguous', ed_severity: 'medium', negatable: true, re: /(?<!\p{L})sadece\s+su\s+(?:iciyo|icerek)/u, question_tr: 'Günlerdir yalnızca su ile beslenme (kısıtlama) mı?' },
  // ── v1 ED catch-alls: LAST, so a curated pattern over the same words always wins the dedupe.
  // They only surface for v1 hits nothing above recognised (e.g. a phrase glued inside a word).
  // (v1's emergency/crisis lists are the v1 floor, explicit, below.)
  { id: 'ed.v1_kanit', category: 'ed', tier: 'ambiguous', ed_severity: 'high', find: phraseFinder(V1_ED_EVIDENCE_PHRASES), question_tr: 'Kilo kontrolü için kusma mı, yoksa hastalık/zehirlenme/gebelik mi?' },
  { id: 'ed.v1_yuksek', category: 'ed', tier: 'ambiguous', ed_severity: 'high', negatable: true, find: phraseFinder(V1_ED_HIGH_PHRASES.filter((p) => !V1_ED_EVIDENCE_PHRASES.includes(p))), question_tr: 'Çıkarma davranışı (kusma, laksatif) mı, yoksa hastalık ya da reddetme mi?' },
  { id: 'ed.v1_orta', category: 'ed', tier: 'ambiguous', ed_severity: 'medium', negatable: true, find: phraseFinder(V1_ED_MEDIUM_PHRASES), question_tr: 'Kısıtlayıcı yeme ya da olumsuz beden algısı (YB sinyali) mi, yoksa sıradan bir ifade mi?' },
];

/** Declaration cues (§11 risk 3): facts for the "Stage A wrote no constraint — why?" backstop. */
export const SIGNAL_TRIPWIRES: readonly TripwireDef[] = [
  { id: 'decl.alerji', category: 'declaration', tier: 'signal', re: /(?<!\p{L})(?:alerj|intolerans|anafila)/u, question_tr: 'Kullanıcı kendisi (ya da başkası) için bir alerji/intolerans mı bildiriyor? Bildiriyorsa constraint_add yaz; yazmıyorsan nedenini self_check\'te söyle.' },
  { id: 'decl.sakatlik', category: 'declaration', tier: 'signal', re: /(?<!\p{L})(?:sakat|incin|incit|burkul|fitik|menisk|ameliyat|operasyon|yirtik|yirtil|zedelen)/u, question_tr: 'Kullanıcı kendisi için bir sakatlık/ameliyat mı bildiriyor? Bildiriyorsa constraint_add yaz; yazmıyorsan nedenini self_check\'te söyle.' },
];

/**
 * The v1 phrases the SPEC puts on the AMBIGUOUS list (§3.2 T2 "BELİRSİZ liste (bayıldım, tükendim,
 * kustum, kalp çarpıntısı, aç kalma…)", §7.2) — every spelling v1's own lists carry. v1 answers
 * them instantly and over-fires ("bu tarife bayıldım" → 112, a verified v1 defect in §1); v2 asks
 * Stage A and stays PROTECTIVE BY DEFAULT (resolveTripwires): without a qualifying benign reading
 * the protective path, on a Stage A failure today's canned reply. ("kustum", "aç kalma" are ED:
 * v1's ED list is ambiguous in v2 already.) Every other v1 phrase and root regex stays explicit.
 * Adding a phrase here removes an instant block: a §7.4 decision (owner approval, shadow
 * evidence, 100% golden-positive recall) — never a code-review call.
 */
export const V1_AMBIGUOUS_PHRASES: Readonly<Record<'emergency' | 'self_harm', readonly string[]>> = {
  emergency: ['bayiliyorum', 'bayılıyorum', 'bayildim', 'bayıldım', 'kalp çarpıntısı', 'kalp carpintisi'],
  self_harm: ['tukendim', 'tükendim'],
};

/** v1's phrases v2 keeps explicit: everything not on the spec's ambiguous list. */
const V1_EXPLICIT_PHRASES: Readonly<Record<'emergency' | 'self_harm', readonly string[]>> = {
  emergency: V1_EMERGENCY_PHRASES.filter((p) => !V1_AMBIGUOUS_PHRASES.emergency.includes(p)),
  self_harm: V1_CRISIS_PHRASES.filter((p) => !V1_AMBIGUOUS_PHRASES.self_harm.includes(p)),
};

/**
 * THE V1 FLOOR (§7.1, §7.4) — explicit, scanned LAST. Every message guardrails.detectEmergency /
 * detectCrisis answers instantly through a phrase or root regex NOT on the spec's ambiguous list
 * is answered instantly by v2: v1's phrase lists (folded, so every spelling v1 knew and more:
 * "KALP KRIZI", "kan kustum") and v1's root regexes (lowercase + the dotted pass, v1 semantics).
 * Unconditional — no narration, person or clause rule applies here. Scanned after the curated
 * tiers, so a curated explicit pattern names the words first and a curated ambiguous reading of
 * the same words is still in `hits` — the ledger then shows "instant only because v1 is" next to
 * what Stage A would have been asked. Moving anything out of this floor is a §7.4 decision: owner
 * approval + shadow evidence.
 */
export const V1_FLOOR_TRIPWIRES: readonly TripwireDef[] = [
  { id: 'emg.v1', category: 'emergency', tier: 'explicit', find: phraseFinder(V1_EXPLICIT_PHRASES.emergency), question_tr: Q_EMERGENCY },
  { id: 'sh.v1', category: 'self_harm', tier: 'explicit', find: phraseFinder(V1_EXPLICIT_PHRASES.self_harm), question_tr: Q_SELF_HARM },
  { id: 'sh.v1_yontem', category: 'self_harm', tier: 'explicit', on: 'lower', re: V1_CRISIS_PATTERNS[0], question_tr: Q_SELF_HARM },
  { id: 'sh.v1_ifade', category: 'self_harm', tier: 'explicit', on: 'lower', re: V1_CRISIS_PATTERNS[1], question_tr: Q_SELF_HARM },
  { id: 'sh.v1_bilek', category: 'self_harm', tier: 'explicit', on: 'lower', re: V1_CRISIS_PATTERNS[2], question_tr: Q_SELF_HARM },
  { id: 'sh.v1_ip_bicak_hap', category: 'self_harm', tier: 'explicit', on: 'lower', re: V1_CRISIS_PATTERNS[3], question_tr: Q_SELF_HARM },
];

/**
 * The spec's ambiguous-list phrases as v1 spells them (folded, glued into words too): AMBIGUOUS,
 * scanned right after the curated ambiguous tier, so "bayıldım" is read as emg.bayilma and this
 * only surfaces where no curated pattern recognised the words ("çokbayıldım"). Either way the
 * message holds a live ambiguous hit — protective by default.
 */
export const V1_AMBIGUOUS_FLOOR_TRIPWIRES: readonly TripwireDef[] = [
  { id: 'emg.v1_belirsiz', category: 'emergency', tier: 'ambiguous', find: phraseFinder(V1_AMBIGUOUS_PHRASES.emergency), question_tr: 'Şu an süren bir belirti (bayılma, çarpıntı) mı, yoksa "çok beğendim" gibi bir deyim ya da geçici/genel bir soru mu?' },
  { id: 'sh.v1_belirsiz', category: 'self_harm', tier: 'ambiguous', find: phraseFinder(V1_AMBIGUOUS_PHRASES.self_harm), question_tr: 'Umutsuzluk/kendine zarar düşüncesi mi, yoksa iş/antrenman yorgunluğu mu?' },
];

/** Triggers of the backstop below: v1, verbatim, on the raw text. */
const V1_BACKSTOP_TRIGGER = { emergency: 'emg.v1_ham', self_harm: 'sh.v1_ham' } as const;

/** Every trigger that is instant ONLY because v1 is (ledger filter for the §7.4 evidence). */
export const V1_FLOOR_TRIGGERS: ReadonlySet<string> = new Set([
  ...V1_FLOOR_TRIPWIRES.map((d) => d.id), ...Object.values(V1_BACKSTOP_TRIGGER),
]);

/** Ambiguous triggers that exist only because v1 answers the phrase instantly (spec's list). */
export const V1_AMBIGUOUS_FLOOR_TRIGGERS: ReadonlySet<string> = new Set(V1_AMBIGUOUS_FLOOR_TRIPWIRES.map((d) => d.id));

/**
 * guardrails.detectEmergency / detectCrisis VERBATIM — same lists, same RegExp objects, the raw
 * text tr-lowercased with no NFC and no folding — split by what v2 does with the match: `explicit`
 * = v1's phrases minus the spec's ambiguous list, plus the root regexes; `ambiguous` = the spec's
 * ambiguous-list phrases. The floor's last word: normalisation can move a v1 match out of the
 * patterns' reach (a combining accent NFC merges into a letter of "kendimi"), and parity must hold
 * by construction, not only on the golden corpus.
 */
function v1VerbatimMatch(lower: string, category: 'emergency' | 'self_harm', part: 'explicit' | 'ambiguous'): { index: number; text: string } | null {
  // `lower` = the raw message, tr-lowercased (v1's `text.toLocaleLowerCase('tr')`), nothing else.
  for (const p of (part === 'explicit' ? V1_EXPLICIT_PHRASES : V1_AMBIGUOUS_PHRASES)[category]) {
    const i = lower.indexOf(p);
    if (i >= 0) return { index: i, text: p };
  }
  if (category === 'self_harm' && part === 'explicit') {
    for (const r of V1_CRISIS_PATTERNS) {
      const m = r.exec(lower);
      if (m) return { index: m.index, text: m[0] };
    }
  }
  return null;
}

/** v1's verdict per category (TripwireScan.v1): explicit beats ambiguous, as v1 fires either way. */
export function v1Verdicts(raw: string): V1Verdicts {
  const lower = (raw ?? '').toLocaleLowerCase('tr');
  const of = (c: 'emergency' | 'self_harm'): V1Verdict =>
    v1VerbatimMatch(lower, c, 'explicit') ? 'explicit' : v1VerbatimMatch(lower, c, 'ambiguous') ? 'ambiguous' : null;
  return { emergency: of('emergency'), self_harm: of('self_harm') };
}

// ─── injection: log only (§7.3) ──────────────────────────────────────────────
// Moved here verbatim from guardrails.ts (v1 still REFUSES on the first list via
// sanitizeUserInput; v2 never refuses, it only logs).

export const INJECTION_REFUSAL_PATTERNS: readonly RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /ignore\s+above/i,
  /disregard\s+(all\s+)?previous/i,
  /system\s*prompt/i,
  /you\s+are\s+(now|no\s+longer)/i,
  /act\s+as\s+(a|an)\s+(?!koc|coach)/i,
  /pretend\s+(to\s+be|you('re|\s+are))/i,
  /roleplay\s+as/i,
  /new\s+instructions/i,
  /override\s+(your|the)\s+(instructions|rules|prompt)/i,
  /reveal\s+(your|the)\s+(system|prompt|instructions)/i,
  /what\s+(are|is)\s+your\s+(system|initial)\s+(prompt|instructions)/i,
  /repeat\s+(your|the)\s+(system|initial)\s+(prompt|instructions)/i,
  /rolunu\s+degistir/i,
  /talimatlarini\s+(goster|göster|yaz)/i,
  /sistem\s+promptunu/i,
  // Additional injection vectors
  /forget\s+(everything|all|your)/i,
  /jailbreak/i,
  /DAN\s+mode/i,
  /developer\s+mode/i,
  /debug\s+mode\s+on/i,
  /unfiltered\s+mode/i,
  /do\s+anything\s+now/i,
  /bypass\s+(safety|filter|guardrail)/i,
  /respond\s+without\s+(filter|restriction)/i,
  /as\s+an?\s+unrestricted/i,
  // Turkish additional patterns
  /filtresiz\s+(cevap|yanit|yanitla)/i,
  /kural(lar)?\s*i?\s*(yoksay|gormezden|görmezden)/i,
  /sinir(lar)?\s*i?\s*(kaldir|kaldır|yoksay)/i,
  /guvenlik(leri)?\s*(kapat|devre\s*disi)/i,
  /onceki\s+(tum\s+|butun\s+)?talimatlari\s+(unut|yoksay|gormezden|gozardi)/i,
];

/** "sen artık …" is ordinary Turkish ("sen artık benim koçumsun") — logged, never refused. */
export const INJECTION_LOG_ONLY_PATTERNS: readonly RegExp[] = [
  /sen\s+(artık|artik)\s+(bir|)/i,
];

// ─── canned replies (explicit path + fail-closed fallback) ───────────────────

export type CannedKind = 'emergency' | 'self_harm' | 'ed_high' | 'ed_medium';

export interface SafetyResource {
  label_tr: string;
  /** Only verified numbers. 112 is Turkey's single emergency line; nothing else is invented. */
  phone: string | null;
}

export interface CannedSafetyResponse {
  kind: CannedKind;
  message: string;
  resources: readonly SafetyResource[];
  /** TurnEnvelope.task_mode the client already knows (v1 parity). */
  task_mode: 'emergency' | 'safety';
  /** Facts in the message (an allergy, an injury) are salvaged — in the background, after the
   * reply is sent, never delaying it (§7.1 "Mesajdaki olgular kurtarılır"). */
  salvage_facts: boolean;
}

const RES_112: SafetyResource = { label_tr: 'Acil çağrı (ambulans, 7/24)', phone: '112' };
const RES_PRO: SafetyResource = { label_tr: 'Psikolog ya da psikiyatrist', phone: null };
const RES_ED: SafetyResource = { label_tr: 'Yeme bozukluklarında deneyimli uzman (psikolog, psikiyatrist, diyetisyen)', phone: null };

export const CANNED_SAFETY: Readonly<Record<CannedKind, CannedSafetyResponse>> = {
  emergency: {
    kind: 'emergency',
    message: "Anlattığın belirti acil olabilir. Lütfen şimdi 112'yi ara ya da en yakın acil servise git; yanında biri varsa ona da hemen haber ver. Ben bir yaşam tarzı koçuyum, acil bir sağlık durumunda sana doğru yardımı ancak sağlık ekipleri verebilir. Sağlığın her şeyden önemli; kendini iyi hissettiğinde buradayım.",
    resources: [RES_112],
    task_mode: 'emergency',
    salvage_facts: true,
  },
  self_harm: {
    kind: 'self_harm',
    message: "Bunu benimle paylaştığın için teşekkür ederim; şu an yaşadıkların çok ağır olmalı ve yalnız değilsin. Kendine zarar verme ihtimalin varsa ya da kendini güvende hissetmiyorsan lütfen hemen 112'yi ara. Güvendiğin birine, bir yakınına da şimdi haber ver. Bir psikolog ya da psikiyatristten destek almak bu duygularla baş etmende gerçekten yardımcı olur. Ben bir yaşam tarzı koçuyum ve profesyonel desteğin yerini tutamam, ama senin için endişeleniyorum ve buradayım.",
    resources: [RES_112, RES_PRO],
    task_mode: 'safety',
    salvage_facts: true,
  },
  ed_high: {
    kind: 'ed_high',
    message: "Anlattıkların için teşekkür ederim, bunu söylemek kolay değil. Bu konuda sana gerçekten yardımcı olabilecek bir uzmana ulaşman çok önemli: bir psikolog, psikiyatrist ya da yeme bozukluklarında deneyimli bir diyetisyen. Türkiye Yeme Bozuklukları Derneği de sana yol gösterebilir. Baş dönmesi, bayılma ya da çarpıntı olursa 112'yi ara. Yalnız değilsin.",
    resources: [RES_ED, RES_112],
    task_mode: 'safety',
    salvage_facts: true,
  },
  ed_medium: {
    kind: 'ed_medium',
    message: 'Anlattıkların beni biraz endişelendirdi. Bu konuyu bir uzmanla, örneğin bir diyetisyen ya da psikologla konuşman sana iyi gelebilir; profesyonel destek almak güçlü bir adımdır.',
    resources: [RES_ED],
    task_mode: 'safety',
    salvage_facts: false,
  },
};

/** The line code guarantees on the protective path when the coach's own reply lacks it (§7.2). */
export const REQUIRED_SAFETY_LINE: Readonly<Record<SafetyCategory, string>> = {
  emergency: "Belirtilerin acil olabilir: lütfen hemen 112'yi ara ya da en yakın acil servise git.",
  self_harm: "Kendini güvende hissetmiyorsan lütfen hemen 112'yi ara ve güvendiğin birine haber ver; bir psikolog ya da psikiyatristten destek almak da çok yardımcı olur.",
  ed: 'Bu konuyu bir uzmanla, örneğin bir diyetisyen ya da psikologla konuşman sana iyi gelebilir.',
};

/**
 * A referral, not a mere mention of a profession ("Ben diyetisyen değilim" is not one): a
 * profession followed within four words (none of them "değil…") by a referral verb, and not waved
 * away within the next two words of the same clause. Turkish usually puts a verb between the
 * referral word and the dismissal ("Profesyonel yardım almana gerek yok", "Uzman desteği almana
 * hiç gerek yok", "Psikolog yardımı almak zorunda değilsin" — wave-2a review); punctuation ends the
 * reach, so "…görüşmeni öneririm; beklemene gerek yok" is still a referral.
 */
const ED_REFERRAL = /(?<!\p{L})(?:diyetisyen|psikolog|psikiyatr|uzman|profesyonel)\p{L}*(?:\s+(?!degil)\p{L}+){0,4}?\s+(?:konus|gorus|danis|basvur|ulas|deste[kg]|yardim|gorun|git)\p{L}*/gu;
const REFERRAL_WAVED_AWAY = /^(?:\s+\p{L}+){0,2}?\s+(?:hic\s+)?(?:gerek\s+(?:yok|kalma|duyma)|gerekmez|gerekmiyo|zorunda\s+degil|sart\s+degil|lazim\s+degil)/u;

function hasEdReferral(reply: string): boolean {
  const f = foldTripwireText(reply);
  for (const m of f.matchAll(ED_REFERRAL)) {
    if (!REFERRAL_WAVED_AWAY.test(f.slice((m.index ?? 0) + m[0].length))) return true;
  }
  return false;
}

/**
 * Reads the REPLY (never the user's message): does it already carry the required line?
 * HEURISTIC over the coach's prose — when Stage B reports a structured referral/112 flag, that flag
 * is the primary signal and this is only the code-side check. It errs toward "missing": a false
 * "missing" costs one appended line, a false "present" would drop the referral.
 */
export function hasRequiredSafetyLine(reply: string, category: SafetyCategory): boolean {
  if (category === 'ed') return hasEdReferral(reply ?? '');
  return /(?<!\d)112(?!\d)/.test(reply ?? '');
}

/** Append-only (§5.3: code never deletes from a reply): adds the required line if it is missing. */
export function ensureRequiredSafetyLine(reply: string, category: SafetyCategory): string {
  const text = reply ?? '';
  if (hasRequiredSafetyLine(text, category)) return text;
  const line = REQUIRED_SAFETY_LINE[category];
  return text.trim() ? `${text.trimEnd()}\n\n${line}` : line;
}

// ─── scan ────────────────────────────────────────────────────────────────────

function* occurrences(def: TripwireDef, t: Texts): Generator<Span> {
  // All three texts share one length and one index map, so a span from any of them is valid.
  const texts: [string, 'folded' | 'lower' | 'dotted'][] = def.on === 'lower'
    ? (t.lowerDotted === t.lower ? [[t.lower, 'lower']] : [[t.lower, 'lower'], [t.lowerDotted, 'dotted']])
    : [[t.folded, 'folded']];
  for (const [text, pass] of texts) {
    if (def.find) {
      yield* def.find(text, pass);
      continue;
    }
    if (!def.re) return;
    const re = new RegExp(def.re.source, def.re.flags.includes('g') ? def.re.flags : def.re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      yield { index: m.index, length: m[0].length };
    }
  }
}

const overlaps = (a: Span, b: Span): boolean => a.index < b.index + b.length && b.index < a.index + a.length;

/**
 * Scan the USER's message (never the coach's text — final2#9: the coach's own "aç kalma" advice
 * must not be able to trigger anything). ~1 ms; call before any LLM work.
 */
export function scanTripwires(userMessage: string): TripwireScan {
  const t = buildTexts(userMessage ?? '');
  const hits: TripwireHit[] = [];
  const spans: Span[] = []; // spans[i] belongs to hits[i]
  let n = 0;
  const sev = (s: EdSeverity | null | undefined): number => (s === 'high' ? 2 : s === 'medium' ? 1 : 0);

  /** Folded end of the word the span ends in ("bayıl" → "bayıldım"). */
  const wordEnd = (s: Span): number => {
    let end = s.index + s.length;
    while (end < t.folded.length && /\p{L}/u.test(t.folded[end])) end++;
    return end;
  };
  const isNarrated = (def: TripwireDef, s: Span): boolean => {
    if (!def.narration) return false;
    const end = wordEnd(s);
    const span = t.folded.slice(s.index, end);
    const verb = span.slice(span.lastIndexOf(' ') + 1);
    const tail = t.folded.slice(end);
    const next = /^ (\p{L}+)/u.exec(tail)?.[1] ?? '';
    const after = t.folded[end] === ' ' ? t.folded.slice(end + 1, end + 61) : '';
    return def.narration(verb, next, after, { before: t.folded.slice(Math.max(0, s.index - 80), s.index), tail });
  };

  const consider = (def: TripwireDef) => {
    // One fact per place: an occurrence over the same words as an earlier hit of the same
    // category adds nothing for Stage A — unless it is live where that hit was negated, or more
    // severe. (Catch-alls run last, so this keeps them to what the curated patterns missed.)
    // An instant (explicit, not narrated) occurrence is only ever redundant to another explicit
    // hit: a narrated fact over the same words can never swallow it.
    const redundant = (s: Span, negated: boolean, instant: boolean): boolean => hits.some((h, i) =>
      h.category === def.category && overlaps(spans[i], s) &&
      (!instant || h.tier === 'explicit') &&
      (negated || (!h.negated && sev(h.ed_severity) >= sev(def.ed_severity))));
    let chosen: { span: Span; negated: boolean; narrated: boolean } | null = null;
    let best = -1;
    for (const s of occurrences(def, t)) {
      const negated = !!def.negatable && negatedAfter(t, s.index + s.length);
      const narrated = isNarrated(def, s);
      if (redundant(s, negated, def.tier === 'explicit' && !narrated)) continue;
      // A live occurrence beats a negated one; an instant one beats a narrated one; else the first.
      const score = (negated ? 0 : 2) + (narrated ? 0 : 1);
      if (score > best) { chosen = { span: s, negated, narrated }; best = score; }
      if (best === 3) break;
    }
    if (!chosen) return;
    const { index, length } = chosen.span;
    spans.push(chosen.span);
    // Quote whole words ("bayıldım", not the stem "bayıl") so Stage A reads what the user wrote.
    const end = wordEnd(chosen.span);
    hits.push({
      hit_id: `tw${++n}`,
      trigger: chosen.narrated ? `${def.id}.anlatim` : def.id,
      category: def.category,
      tier: chosen.narrated ? 'ambiguous' : def.tier,
      matched: originalSlice(t, index, end),
      context: originalSlice(t, Math.max(0, index - 40), Math.min(t.folded.length, index + length + 40)),
      negated: chosen.negated,
      ed_severity: def.ed_severity ?? null,
      question_tr: chosen.narrated ? (def.narration_q ?? def.question_tr) : def.question_tr,
    });
  };
  for (const def of EXPLICIT_TRIPWIRES) consider(def);
  for (const def of AMBIGUOUS_TRIPWIRES) consider(def);
  for (const def of V1_AMBIGUOUS_FLOOR_TRIPWIRES) consider(def);
  for (const def of SIGNAL_TRIPWIRES) consider(def);
  for (const def of V1_FLOOR_TRIPWIRES) consider(def);

  // The backstop: v1 verbatim on the raw text. Only reached when normalisation moved a v1 match
  // out of every pattern's reach; then the whole message is the span (nothing is scanned after).
  // (A v1 match only on the spec's ambiguous list needs no hit here: the folded phrase search finds
  // every substring v1's does, and resolveTripwires protects a v1-ambiguous category that holds no
  // live hit anyway — `v1` below.)
  const raw = userMessage ?? '';
  const rawLower = raw.toLocaleLowerCase('tr');
  for (const category of ['emergency', 'self_harm'] as const) {
    if (hits.some((h) => h.tier === 'explicit' && h.category === category)) continue;
    const m = v1VerbatimMatch(rawLower, category, 'explicit');
    if (!m) continue;
    const quotable = rawLower.length === raw.length;
    spans.push({ index: 0, length: t.folded.length });
    hits.push({
      hit_id: `tw${++n}`,
      trigger: V1_BACKSTOP_TRIGGER[category],
      category,
      tier: 'explicit',
      matched: (quotable ? raw.slice(m.index, m.index + m.text.length) : m.text).normalize('NFC').trim(),
      context: (quotable ? raw.slice(Math.max(0, m.index - 40), m.index + m.text.length + 40) : m.text).normalize('NFC').trim(),
      negated: false,
      ed_severity: null,
      question_tr: category === 'emergency' ? Q_EMERGENCY : Q_SELF_HARM,
    });
  }
  const v1 = v1Verdicts(raw);

  // v1 order: emergency outranks self-harm (both answers carry 112).
  const explicit = hits.find((h) => h.tier === 'explicit' && h.category === 'emergency')
    ?? hits.find((h) => h.tier === 'explicit' && h.category === 'self_harm')
    ?? null;

  const injection: InjectionHit[] = [];
  const src = t.src;
  for (const p of INJECTION_REFUSAL_PATTERNS) if (p.test(src) || p.test(t.folded)) injection.push({ pattern: p.source, refused_in_v1: true });
  for (const p of INJECTION_LOG_ONLY_PATTERNS) if (p.test(src) || p.test(t.folded)) injection.push({ pattern: p.source, refused_in_v1: false });

  return { explicit, hits, injection, v1 };
}

/** Ambiguous hits that would trigger today's protection (a negated ED hit is a fact only). */
export function liveAmbiguousHits(scan: TripwireScan): TripwireHit[] {
  return scan.hits.filter((h) => h.tier === 'ambiguous' && !h.negated);
}

// ─── facts for Stage A ───────────────────────────────────────────────────────

export interface TripwireFact {
  hit_id: string;
  trigger: string;
  category: TripwireCategory;
  tier: 'ambiguous' | 'signal';
  matched: string;
  negated: boolean;
  question_tr: string;
}

/** What Stage A receives (§3.2 T4 "tetik olguları"). Explicit hits never reach Stage A. */
export function tripwireFacts(scan: TripwireScan): TripwireFact[] {
  return scan.hits
    .filter((h): h is TripwireHit & { tier: 'ambiguous' | 'signal' } => h.tier !== 'explicit')
    .map((h) => ({ hit_id: h.hit_id, trigger: h.trigger, category: h.category, tier: h.tier, matched: h.matched, negated: h.negated, question_tr: h.question_tr }));
}

const CATEGORY_TR: Record<TripwireCategory, string> = {
  emergency: 'acil durum', self_harm: 'kendine zarar', ed: 'yeme bozukluğu', declaration: 'beyan',
};

/** Compact Turkish block for the Stage A prompt; '' when there is nothing to read. */
export function renderTripwireFacts(scan: TripwireScan): string {
  const facts = tripwireFacts(scan);
  if (facts.length === 0) return '';
  const lines = facts.map((f) => {
    const tags = [CATEGORY_TR[f.category], f.tier === 'signal' ? 'beyan ipucu' : 'belirsiz'];
    if (f.negated) tags.push('olumsuzlanmış olabilir');
    return `- ${f.hit_id} [${tags.join(' · ')}] "${f.matched}" — ${f.question_tr}`;
  });
  return [
    'GÜVENLİK TETİKLERİ (kod kelimeyi buldu, anlamını sen okursun). Belirsiz olanların HER BİRİ için safety.tripwire_readings listesine hit_id, okuma (positive/benign) ve gerekçe yaz; emin değilsen positive say.',
    ...lines,
  ].join('\n');
}

// ─── optional parallel classifier (luna, emergency/self-harm only, §3.2 T2) ──

export interface ClassifierVerdict {
  reading: 'positive' | 'benign' | 'unclear';
  reason: string;
}

export interface ClassifierRequest {
  message: string;
  hits: { hit_id: string; trigger: string; category: SafetyCategory; matched: string; question_tr: string }[];
}

/** Injected transport (luna strict-schema call). Must honour the abort signal. */
export type TripwireClassifier = (req: ClassifierRequest, signal: AbortSignal) => Promise<unknown>;

export type ClassifierOutcome =
  | { status: 'skipped' }
  | { status: 'ok'; verdict: ClassifierVerdict; ms: number }
  | { status: 'failed'; reason: 'timeout' | 'error' | 'invalid'; ms: number };

export const TRIPWIRE_CLASSIFIER_SCHEMA = {
  name: 'kochko_tripwire_v1',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['reading', 'reason'],
    properties: {
      reading: { type: 'string', enum: ['positive', 'benign', 'unclear'] },
      reason: { type: 'string' },
    },
  },
} as const;

export const TRIPWIRE_CLASSIFIER_INSTRUCTIONS = [
  'Bir sağlık koçluğu uygulamasında bağımsız güvenlik ikinci görüşüsün.',
  'Kullanıcının mesajında bir güvenlik tetik ifadesi geçti. Tek soruya cevap ver: bu mesaj ŞU AN akut bir tıbbi acil durumu ya da kendine zarar verme / yaşamak istememe düşüncesini anlatıyor mu?',
  '- Anlatıyorsa ya da emin değilsen: reading = "positive" (şüphede koruma).',
  '- Yalnızca mesaj açıkça başka bir anlam taşıyorsa (ör. "bu tarife bayıldım" = çok beğendim, "işte tükendim" = iş yorgunluğu, geçmişte kalmış ya da başkası hakkında bir olay): reading = "benign" ve gerekçeyi tek cümleyle yaz.',
  '- Mesaj anlamsız ya da yetersizse: reading = "unclear".',
  'Tavsiye verme, yalnızca sınıflandır.',
].join('\n');

/** Defensive parse of whatever the transport returned (object or JSON string). */
export function parseClassifierVerdict(raw: unknown): ClassifierVerdict | null {
  let v: unknown = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const reading = o.reading;
  if (reading !== 'positive' && reading !== 'benign' && reading !== 'unclear') return null;
  const reason = typeof o.reason === 'string' ? o.reason.trim().slice(0, 300) : '';
  return { reading, reason };
}

/** Only an emergency/self-harm ambiguous hit asks for the independent second reading. */
export function classifierNeeded(scan: TripwireScan): boolean {
  return !scan.explicit && liveAmbiguousHits(scan).some((h) => h.category === 'emergency' || h.category === 'self_harm');
}

/**
 * Run the classifier in parallel with Stage A. Never throws: a timeout, transport error or
 * malformed answer is a FAILED outcome, which resolveTripwires treats as "not benign".
 */
export async function runTripwireClassifier(
  scan: TripwireScan,
  userMessage: string,
  classifier: TripwireClassifier | null | undefined,
  opts: { timeoutMs?: number } = {},
): Promise<ClassifierOutcome> {
  if (!classifier || !classifierNeeded(scan)) return { status: 'skipped' };
  const timeoutMs = opts.timeoutMs ?? 4000;
  const req: ClassifierRequest = {
    message: userMessage,
    hits: liveAmbiguousHits(scan)
      .filter((h): h is TripwireHit & { category: SafetyCategory } => h.category === 'emergency' || h.category === 'self_harm')
      .map((h) => ({ hit_id: h.hit_id, trigger: h.trigger, category: h.category, matched: h.matched, question_tr: h.question_tr })),
  };
  const started = Date.now();
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => { ctrl.abort(); resolve('timeout'); }, timeoutMs);
  });
  try {
    const raw = await Promise.race([classifier(req, ctrl.signal), timedOut]);
    const ms = Date.now() - started;
    if (raw === 'timeout') return { status: 'failed', reason: 'timeout', ms };
    const verdict = parseClassifierVerdict(raw);
    return verdict ? { status: 'ok', verdict, ms } : { status: 'failed', reason: 'invalid', ms };
  } catch {
    return { status: 'failed', reason: ctrl.signal.aborted ? 'timeout' : 'error', ms: Date.now() - started };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ─── the §7.2 decision table ─────────────────────────────────────────────────

export interface TripwireReading {
  hit_id: string;
  reading: 'positive' | 'benign';
  reason: string;
}

/** A Stage A safety positive with or without a tripwire (catches what the lists miss). */
export interface StageASafetyPositive {
  category: SafetyCategory;
  ed_severity?: EdSeverity | null;
}

export type StageASafetyOutcome =
  | { status: 'ok'; readings: readonly TripwireReading[]; positives: readonly StageASafetyPositive[] }
  | { status: 'timeout' | 'error' | 'refused' };

export interface ResolveTripwiresInput {
  scan: TripwireScan;
  /** null = Stage A did not run (counts as failure when a live trigger exists). */
  stageA: StageASafetyOutcome | null;
  classifier?: ClassifierOutcome | null;
  /** §10 Faz 3: a reasoned benign reading may lift protection only after the B+ gate passes.
   * Until then it is logged as `benign_suppressed` (shadow evidence) and protection applies. */
  benignOverride?: boolean;
}

export interface TripwireLog {
  version: string;
  explicit: string | null;
  ambiguous: string[];
  negated: string[];
  signals: string[];
  injection: string[];
  stage_a: 'ok' | 'timeout' | 'error' | 'refused' | 'not_run';
  readings: { trigger: string; reading: 'positive' | 'benign' | 'missing' }[];
  classifier: 'skipped' | 'positive' | 'benign' | 'unclear' | 'timeout' | 'error' | 'invalid';
  outcome: 'canned' | 'fallback' | 'protective' | 'normal';
  benign_suppressed: boolean;
  /** ±40-char windows, only where a benign reading was accepted or suppressed (§7.2 triage). */
  contexts: string[];
  /** v1's own verdict on the message (TripwireScan.v1): a 'normal' or 'protective' outcome on a
   * v1-instant message is the §7.4 evidence a future demotion needs. Set by resolveTripwires;
   * absent only on a hand-built placeholder log. */
  v1?: V1Verdicts;
}

export type TripwireDecision =
  | { kind: 'canned'; category: 'emergency' | 'self_harm'; response: CannedSafetyResponse; log: TripwireLog }
  | {
    kind: 'fallback';
    category: SafetyCategory;
    response: CannedSafetyResponse;
    /** replace = the canned text IS the reply; append = coaching continues, referral appended. */
    mode: 'replace' | 'append';
    /** §7.3: on the fallback path only, the tier may still be escalated from the tripwire. */
    ed_signal: EdSeverity | null;
    log: TripwireLog;
  }
  | {
    kind: 'protective';
    category: SafetyCategory;
    categories: SafetyCategory[];
    ed_severity: EdSeverity | null;
    /** Stage B contract to use: crisis (112) or ED support (referral). */
    route: 'crisis' | 'ed_support';
    /** Code guarantees this line if the coach's reply lacks it (ensureRequiredSafetyLine). */
    required_line: string;
    /** Used when Stage B fails or exceeds its budget (§7.2: 6 s). */
    fallback: CannedSafetyResponse;
    log: TripwireLog;
  }
  | { kind: 'normal'; log: TripwireLog };

const CATEGORY_RANK: Record<SafetyCategory, number> = { emergency: 3, self_harm: 2, ed: 1 };

interface Concern { category: SafetyCategory; ed_severity: EdSeverity | null }

function worst(concerns: Concern[]): Concern {
  const score = (c: Concern) => CATEGORY_RANK[c.category] * 10 + (c.ed_severity === 'high' ? 1 : 0);
  return concerns.reduce((a, b) => (score(b) > score(a) ? b : a));
}

function cannedFor(c: Concern): CannedSafetyResponse {
  if (c.category === 'ed') return CANNED_SAFETY[c.ed_severity === 'high' ? 'ed_high' : 'ed_medium'];
  return CANNED_SAFETY[c.category];
}

const isSafety = (c: TripwireCategory): c is SafetyCategory => c !== 'declaration';

type ReadingVerdict = 'protect' | 'suppressed' | 'lift' | 'silent';

/**
 * What one ambiguous safety hit's reading does — PROTECTIVE BY DEFAULT (§7.2, §7.4.1: "her hit ya
 * korumayı uygular ya da iki bağımsız benign okuma ister"):
 *   protect     no reading, a positive one, an unreasoned benign, or (emergency/self-harm) a
 *               reasoned benign the classifier did not independently confirm
 *   suppressed  a reasoned benign while the override gate is off (§10 Faz 3: B+ gate) — logged as
 *               shadow evidence, protection applies
 *   lift        a QUALIFYING benign: reasoned, override on, and for emergency/self-harm the
 *               classifier's own benign too
 *   silent      a negated ED hit Stage A did not read as positive (v1 is silent on it too)
 */
function readingVerdict(h: TripwireHit, r: TripwireReading | undefined, benignOverride: boolean, classifierBenign: boolean): ReadingVerdict {
  if (r?.reading === 'positive') return 'protect';
  if (h.negated) return 'silent';
  if (!(r?.reading === 'benign' && r.reason.trim().length > 0)) return 'protect';
  if (!benignOverride) return 'suppressed';
  if ((h.category === 'emergency' || h.category === 'self_harm') && !classifierBenign) return 'protect';
  return 'lift';
}

/**
 * §7.2 as a pure function. Protection never drops below today's:
 *   explicit hit                         → canned, no LLM
 *   live trigger + Stage A failed        → today's canned reply (fail-closed)
 *   trigger without a QUALIFYING benign  → protective path (readingVerdict)
 *   qualifying benign on every trigger   → normal — only with the override gate on, and for
 *                                          emergency/self-harm only with the classifier's benign
 *   no trigger + Stage A positive        → protective path
 * The v1 floor holds by construction: a message v1 answers instantly is canned when v1 fires on an
 * explicit-floor phrase, and when it fires only on the spec's ambiguous list (TripwireScan.v1) its
 * category is protected unless a live hit of that category carries a qualifying benign — the scan
 * always leaves such a hit; a scan without one is treated as a trigger nobody read.
 */
export function resolveTripwires(input: ResolveTripwiresInput): TripwireDecision {
  const { scan, stageA, classifier = null, benignOverride = false } = input;
  const live = liveAmbiguousHits(scan).filter((h) => isSafety(h.category));
  const holds = (c: 'emergency' | 'self_harm', tier: TripwireTier) => scan.hits.some((h) => h.category === c && h.tier === tier && !h.negated);
  /** v1-instant categories with no hit that carries them (never for a scan from scanTripwires). */
  const v1Explicit = (['emergency', 'self_harm'] as const).find((c) => scan.v1?.[c] === 'explicit' && !holds(c, 'explicit')) ?? null;
  const v1Unread: Concern[] = (['emergency', 'self_harm'] as const)
    .filter((c) => scan.v1?.[c] === 'ambiguous' && !holds(c, 'explicit') && !holds(c, 'ambiguous'))
    .map((c) => ({ category: c, ed_severity: null }));
  const log: TripwireLog = {
    version: TRIPWIRES_VERSION,
    explicit: scan.explicit?.trigger ?? null,
    ambiguous: live.map((h) => h.trigger),
    negated: scan.hits.filter((h) => h.negated).map((h) => h.trigger),
    signals: scan.hits.filter((h) => h.tier === 'signal').map((h) => h.trigger),
    injection: scan.injection.map((i) => i.pattern),
    stage_a: stageA ? stageA.status : 'not_run',
    readings: [],
    classifier: !classifier || classifier.status === 'skipped' ? 'skipped'
      : classifier.status === 'ok' ? classifier.verdict.reading : classifier.reason,
    outcome: 'normal',
    benign_suppressed: false,
    contexts: [],
    v1: scan.v1,
  };

  // v1 order: emergency before self-harm.
  const explicitCategory = scan.explicit?.category;
  const cannedCategory = explicitCategory === 'emergency' || v1Explicit === 'emergency' ? 'emergency'
    : explicitCategory === 'self_harm' || v1Explicit === 'self_harm' ? 'self_harm' : null;
  if (cannedCategory) {
    log.outcome = 'canned';
    return { kind: 'canned', category: cannedCategory, response: CANNED_SAFETY[cannedCategory], log };
  }

  if (!stageA || stageA.status !== 'ok') {
    const unread = [...live.map((h) => ({ category: h.category as SafetyCategory, ed_severity: h.ed_severity })), ...v1Unread];
    if (unread.length === 0) return { kind: 'normal', log };
    const c = worst(unread);
    log.outcome = 'fallback';
    const appendOnly = c.category === 'ed' && c.ed_severity !== 'high';
    return {
      kind: 'fallback', category: c.category, response: cannedFor(c),
      mode: appendOnly ? 'append' : 'replace',
      ed_signal: c.category === 'ed' ? (c.ed_severity ?? 'medium') : null,
      log,
    };
  }

  const readings = new Map(stageA.readings.map((r) => [r.hit_id, r]));
  const concerns: Concern[] = [...v1Unread];
  const classifierBenign = classifier?.status === 'ok' && classifier.verdict.reading === 'benign';
  for (const h of scan.hits) {
    if (h.tier !== 'ambiguous' || !isSafety(h.category)) continue;
    const r = readings.get(h.hit_id);
    log.readings.push({ trigger: h.trigger, reading: r?.reading ?? 'missing' });
    const verdict = readingVerdict(h, r, benignOverride, classifierBenign);
    if (verdict === 'silent') continue;
    if (r?.reading === 'benign' && r.reason.trim()) log.contexts.push(h.context);
    if (verdict === 'suppressed') log.benign_suppressed = true;
    if (verdict !== 'lift') concerns.push({ category: h.category, ed_severity: h.ed_severity });
  }
  for (const p of stageA.positives) concerns.push({ category: p.category, ed_severity: p.category === 'ed' ? (p.ed_severity ?? 'medium') : null });

  if (concerns.length === 0) return { kind: 'normal', log };
  const c = worst(concerns);
  log.outcome = 'protective';
  return {
    kind: 'protective',
    category: c.category,
    categories: [...new Set(concerns.map((x) => x.category))].sort((a, b) => CATEGORY_RANK[b] - CATEGORY_RANK[a]),
    ed_severity: c.category === 'ed' ? (c.ed_severity ?? 'medium') : null,
    route: c.category === 'ed' ? 'ed_support' : 'crisis',
    required_line: REQUIRED_SAFETY_LINE[c.category],
    fallback: cannedFor(c),
    log,
  };
}
