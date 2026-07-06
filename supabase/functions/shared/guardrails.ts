/**
 * GUARDRAIL SYSTEM
 * Spec Section 12: Güvenlik ve Guardrail Sistemi
 *
 * All AI output passes through this BEFORE reaching the user.
 * Code-based enforcement, not prompt-dependent.
 */

// Spec 12.1: Absolute calorie floors
const CALORIE_FLOOR = { male: 1400, female: 1200 };

// Spec 12.1: Max weekly loss rate
const MAX_WEEKLY_LOSS_KG = 1.0;

// Spec 12.2: Max workout duration
const MAX_WORKOUT_DURATION_MIN = 120;

// Spec 12.3: Forbidden medical phrases (Turkish)
// NOTE: bare 'hastalık' is deliberately NOT here — the app itself labels the
// illness periodic state with it ('Hastalık döneminde...'), and sanitizing it
// mangled legitimate plan focus_message text into '[yasam tarzi notu] döneminde'.
// The clinical combos below (teşhis/tedavi/hastalığınız) still catch medical
// overreach without eating the app's own vocabulary.
const FORBIDDEN_PHRASES = [
  'teshis', 'teşhis', 'tani koy', 'tanı koy', 'tedavi',
  'ilac', 'ilaç', 'recete', 'reçete', 'doktor olarak', 'tibbi olarak', 'tıbbi olarak',
  'tibbi tavsiye', 'tıbbi tavsiye', 'hastaligınız', 'hastalığınız', 'rahatsizligınız',
  'rahatsızlığınız', 'metabolizma bozukluğu', 'beslenme bozuklugu', 'beslenme bozukluğu',
  'diyetisyen olarak',
];

// Spec 12.4: Allergen filter - these MUST be code-enforced, not prompt-dependent
export interface AllergenCheck {
  passed: boolean;
  violations: string[];
}

/**
 * Category -> concrete food tokens that contain that allergen.
 * Shared so guardrails.ts and service-contexts.ts use the same coverage.
 * Keys are stored lowercased (tr locale); both diacritic and ascii variants
 * are included so a stored allergen like "süt" or "sut" both resolve.
 */
// FIX (audit guardrails_allergen): added English food names (peanut/milk/cheese/egg/fish/
// bread/pasta/wheat...) and the "yer fıstığı" compound so an English meal label or the
// peanut-butter compound can't slip past the allergen guardrail (anafilaksi riski).
export const ALLERGEN_FOODS: Record<string, string[]> = {
  gluten: ['ekmek', 'makarna', 'bulgur', 'simit', 'börek', 'borek', 'poğaça', 'pogaca', 'pasta', 'pizza', 'kek', 'bisküvi', 'biskuvi', 'bread', 'wheat', 'noodle', 'cereal', 'cracker'],
  laktoz: ['süt', 'sut', 'peynir', 'yoğurt', 'yogurt', 'kaymak', 'krema', 'dondurma', 'ayran', 'kefir', 'tereyağ', 'tereyag', 'milk', 'cheese', 'butter', 'cream', 'yoghurt', 'yogurt', 'ice cream'],
  süt: ['süt', 'sut', 'peynir', 'yoğurt', 'yogurt', 'kaymak', 'krema', 'dondurma', 'ayran', 'kefir', 'tereyağ', 'tereyag', 'milk', 'cheese', 'butter', 'cream', 'ice cream'],
  sut: ['süt', 'sut', 'peynir', 'yoğurt', 'yogurt', 'kaymak', 'krema', 'dondurma', 'ayran', 'kefir', 'tereyağ', 'tereyag', 'milk', 'cheese', 'butter', 'cream', 'ice cream'],
  fındık: ['fındık', 'findik', 'hazelnut', 'badem', 'ceviz', 'antep fıstığı', 'antep fistigi', 'kaju', 'cashew', 'walnut', 'almond', 'kuruyemiş', 'kuruyemis', 'nut'],
  findik: ['fındık', 'findik', 'hazelnut', 'badem', 'ceviz', 'antep fıstığı', 'antep fistigi', 'kaju', 'cashew', 'walnut', 'almond', 'kuruyemiş', 'kuruyemis', 'nut'],
  fıstık: ['fıstık', 'fistik', 'yer fıstığı', 'yer fistigi', 'peanut'],
  fistik: ['fıstık', 'fistik', 'yer fıstığı', 'yer fistigi', 'peanut'],
  yumurta: ['yumurta', 'omlet', 'menemen', 'egg', 'omelet', 'omelette'],
  balık: ['balık', 'balik', 'somon', 'levrek', 'hamsi', 'fish', 'salmon', 'tuna', 'ton balığı', 'ton baligi'],
  balik: ['balık', 'balik', 'somon', 'levrek', 'hamsi', 'fish', 'salmon', 'tuna', 'ton balığı', 'ton baligi'],
  // Category-style allergens users actually say ("deniz ürünleri alerjim var") must
  // expand to concrete member foods (karides, midye...) or a shrimp suggestion would
  // slip past the allergen guardrail (#R2-12).
  'deniz ürünleri': ['karides', 'midye', 'kalamar', 'ahtapot', 'istakoz', 'ıstakoz', 'yengeç', 'yengec', 'istiridye', 'balık', 'balik', 'somon', 'levrek', 'hamsi'],
  'deniz urunleri': ['karides', 'midye', 'kalamar', 'ahtapot', 'istakoz', 'istakoz', 'yengec', 'istiridye', 'balik', 'somon', 'levrek', 'hamsi'],
  'deniz mahsulleri': ['karides', 'midye', 'kalamar', 'ahtapot', 'istakoz', 'yengeç', 'yengec', 'istiridye', 'balık', 'balik', 'somon', 'levrek', 'hamsi'],
  kabuklu: ['karides', 'midye', 'istakoz', 'ıstakoz', 'yengeç', 'yengec', 'istiridye', 'kalamar'],
  kabuklular: ['karides', 'midye', 'istakoz', 'ıstakoz', 'yengeç', 'yengec', 'istiridye', 'kalamar'],
};

/**
 * FIX (audit guardrails_allergen): Turkish consonant softening (ünsüz yumuşaması).
 * In inflected forms the stem-final hard consonant softens before a vowel suffix
 * ("fıstık" → "fıstığı", "fındık" → "fındığa", "ekmek" → "ekmeği"). After we strip
 * the suffix we are left with "fıstığ" / "fındığ", which would NOT match the bare
 * "fıstık" / "fındık" token. Normalize the softened final consonant back to its hard
 * form so the stems align.
 */
function softenLastConsonant(w: string): string {
  return w.replace(/ğ$/u, 'k').replace(/b$/u, 'p').replace(/c$/u, 'ç').replace(/d$/u, 't');
}

/**
 * Strip common Turkish derivational/possessive suffixes so inflected
 * forms ("sütlü", "fındıklı") still match the bare token.
 */
function stripTurkishSuffix(word: string): string {
  const s = word
    .replace(/(sız|siz|suz|süz)$/u, '')
    .replace(/(lı|li|lu|lü)$/u, '')
    .replace(/(lar|ler)$/u, '')
    .replace(/(ı|i|u|ü)$/u, '');
  // FIX (audit guardrails_allergen): re-harden the softened stem consonant.
  return softenLastConsonant(s);
}

/**
 * Check AI-generated meal suggestions against user's allergen list.
 * This is a CODE-BASED guardrail (Spec 12.4).
 * Category-expanding, bidirectional, suffix-tolerant match so Turkish
 * inflected/compound forms and multi-word allergens are caught.
 */
export function checkAllergens(
  mealText: string,
  allergens: string[]
): AllergenCheck {
  if (allergens.length === 0) return { passed: true, violations: [] };

  const lowerText = mealText.toLocaleLowerCase('tr');
  // Tokenize meal text for the reverse (short item vs compound allergen) check.
  const textItems = lowerText.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  // FIX (audit guardrails_allergen): normalize the meal text PER-TOKEN (not the whole
  // string) so an inflected word like "fındığı"/"sütlü" reduces to its bare stem
  // ("fındık"/"süt"). The old whole-string stripTurkishSuffix only trimmed the final
  // character of the LAST word, so "fındığı ye" never matched "fındık".
  const normItems = textItems.map(stripTurkishSuffix);

  const violations = allergens.filter(a => {
    const aName = a.toLocaleLowerCase('tr');
    const tokens = new Set<string>([aName, ...(ALLERGEN_FOODS[aName] ?? [])]);
    for (const token of tokens) {
      if (!token) continue;
      // Tokens shorter than 3 chars (e.g. "un"=flour) substring-match common
      // Turkish words and genitive endings ("tavuğun", "kavun"), so they would
      // flag safe meals. Require >=3 chars for substring matching (same guard
      // as the reverse direction below).
      if (token.length < 3) continue;
      const normToken = stripTurkishSuffix(token);
      // Normal direction: meal text contains the token literally (covers multi-word
      // compounds like "yer fıstığı"), OR a normalized meal token equals the
      // normalized allergen stem (covers Turkish inflection + consonant softening).
      // FIX (audit regression): ASCII (English) tokens must match at a WORD BOUNDARY — plain
      // substring let short English roots false-flag ('nut'⊂minute/donut, 'egg'⊂eggplant,
      // 'tuna'=Turkish given name). Turkish tokens keep substring (agglutination: 'sütlü'⊃'süt').
      const isAsciiToken = /^[a-z ]+$/.test(token);
      if (isAsciiToken) {
        if (new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lowerText)) return true;
      } else if (lowerText.includes(token)) {
        return true;
      }
      if (normToken.length >= 3 && normItems.includes(normToken)) return true;
      // Reverse direction: a short meal item is contained in a compound token
      // (e.g. item "süt" vs allergen token "süt ürünleri").
      for (const item of textItems) {
        if (item.length >= 3 && token.includes(item)) return true;
      }
    }
    return false;
  });

  return {
    passed: violations.length === 0,
    violations: violations.map(v => `ALERJEN TESPIT: "${v}" plan/oneride bulundu`),
  };
}

/**
 * Detect allergens DECLARED by the user in a free-text chat message (#R1-H1/H8).
 * Scans the WHOLE message against the ALLERGEN_FOODS vocabulary (category names +
 * member foods) so multi-word/category allergens ("deniz ürünleri", "süt ürünleri")
 * are captured as their canonical name — not the single inflected fragment the old
 * "(word) alerji" regex grabbed ("ürünlerine"). Returns canonical allergen names to
 * store in food_preferences. Returns [] if no allergy/intolerance intent or if negated.
 * For allergens NOT in the dictionary (çilek, kivi...), the caller's single-noun
 * fallback still applies.
 */
// Collapse the synonym/variant keys in ALLERGEN_FOODS to one canonical name per concept
// so a single declaration ("deniz ürünleri alerjim var") stores ONE food_preferences row,
// not 5 (deniz ürünleri/urunleri/mahsulleri/kabuklu/kabuklular). Each canonical value is
// itself a key in ALLERGEN_FOODS, so checkAllergens still expands it correctly.
const ALLERGEN_CANON: Record<string, string> = {
  'deniz ürünleri': 'deniz ürünleri', 'deniz urunleri': 'deniz ürünleri', 'deniz mahsulleri': 'deniz ürünleri',
  kabuklu: 'deniz ürünleri', kabuklular: 'deniz ürünleri',
  laktoz: 'laktoz', 'süt': 'laktoz', sut: 'laktoz',
  'fındık': 'fındık', findik: 'fındık', 'fıstık': 'fıstık', fistik: 'fıstık',
  'balık': 'balık', balik: 'balık', gluten: 'gluten', yumurta: 'yumurta',
};

export function extractDeclaredAllergens(text: string): string[] {
  const lower = text.toLocaleLowerCase('tr');
  if (!/(alerj|intolerans)/.test(lower)) return [];
  if (/(alerjim yok|alerjisi yok|intoleransim yok|intoleransım yok|alerji yok|intolerans yok)/.test(lower)) return [];
  const found = new Set<string>();
  const normText = stripTurkishSuffix(lower);
  const tokens = lower.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(stripTurkishSuffix);
  for (const [aName, members] of Object.entries(ALLERGEN_FOODS)) {
    const normName = stripTurkishSuffix(aName);
    if (lower.includes(aName) || (normName.length >= 4 && normText.includes(normName))) {
      found.add(ALLERGEN_CANON[aName] ?? aName);
      continue;
    }
    for (const m of members) {
      if (m.length < 3) continue;
      const nm = stripTurkishSuffix(m);
      if (lower.includes(m) || tokens.includes(nm)) { found.add(ALLERGEN_CANON[aName] ?? aName); break; }
    }
  }
  return [...found];
}

/**
 * Normalise a food noun to a COMPARISON KEY that collapses Turkish inflection — accusative
 * (-yı/-yi buffer + bare high vowel), ablative (-dan/-den/-tan/-ten), possessive, plural, and
 * consonant softening (balık↔balığı k→ğ, kebap↔kebabı p→b, kitap↔kitabı, ağaç↔ağacı). Two foods
 * "match" iff their keys are EQUAL — token equality, never substring, so "bal"(honey)≠"balık"(fish)
 * and "muz"≠"domuz". Shared so the contradiction reader (service-contexts) and the preference
 * writer/reverser (ai-chat) normalise identically. Known misses: consonant-y stems ("çay") and
 * -lı/-li adjective compounds ("sütlü") — rare in diet-dislike contexts.
 */
export function foodMatchKey(word: string): string {
  const w = word.toLocaleLowerCase('tr');
  return w
    .replace(/(ndan|nden|tan|ten|dan|den|nda|nde|ları|leri|lar|ler|yla|yle|yı|yi|yu|yü|nın|nin|nun|nün|sı|si|su|sü|na|ne)$/u, '')
    .replace(/[ıiuü]$/u, '')
    .replace(/ğ$/u, 'k').replace(/b$/u, 'p').replace(/c$/u, 'ç').replace(/d$/u, 't');
}

/**
 * Validate calorie targets against absolute floors.
 */
export function validateCalories(
  calories: number,
  gender: string | null
): { valid: boolean; corrected: number; message: string } {
  const floor = gender === 'female' ? CALORIE_FLOOR.female : CALORIE_FLOOR.male;
  if (calories < floor) {
    return {
      valid: false,
      corrected: floor,
      message: `Kalori ${floor} altina dusurulemez (${calories} -> ${floor})`,
    };
  }
  return { valid: true, corrected: calories, message: '' };
}

/**
 * Scan text for forbidden medical language (Spec 12.3).
 * Returns cleaned text with violations replaced.
 */
// Spec 12: Eating disorder language patterns - trigger professional referral
const ED_PATTERNS = [
  'kusma', 'kustum', 'kusuyorum',
  'laksatif', 'müshil', 'mushil',
  'aç kalma', 'ac kalma', 'hiç yemiyorum', 'hic yemiyorum',
  'yeme bozukluğu', 'yeme bozuklugu',
  'anoreksiya', 'anorexia', 'bulimiya', 'bulimia',
  'purging', 'binge',
  'kendime zarar', 'intihar',
];

const ED_REFERRAL_MESSAGE =
  'Bu konuda profesyonel destek almanizi oneririz. Turkiye Yeme Bozukluklari Dernegi veya bir uzman diyetisyen/psikolog ile gorusmeniz faydali olacaktir.';

export function sanitizeText(text: string): { clean: string; hadViolations: boolean; edReferral: boolean } {
  let clean = text;
  let hadViolations = false;
  let edReferral = false;

  for (const phrase of FORBIDDEN_PHRASES) {
    const regex = new RegExp(phrase, 'gi');
    if (regex.test(clean)) {
      hadViolations = true;
      clean = clean.replace(regex, '[yasam tarzi notu]');
    }
  }

  // Check for eating disorder language patterns
  const lower = clean.toLocaleLowerCase('tr');
  for (const pattern of ED_PATTERNS) {
    if (lower.includes(pattern)) {
      edReferral = true;
      break;
    }
  }

  if (edReferral) {
    clean = clean + '\n\n' + ED_REFERRAL_MESSAGE;
  }

  return { clean, hadViolations, edReferral };
}

/**
 * Validate macro consistency (Spec 5.29).
 * protein*4 + carbs*4 + fat*9 + alcohol*7 ≈ total calories (10% tolerance)
 */
export function validateMacroConsistency(
  calories: number,
  proteinG: number,
  carbsG: number,
  fatG: number,
  alcoholG: number = 0
): { valid: boolean; calculated: number; message: string } {
  const calculated = Math.round(proteinG * 4 + carbsG * 4 + fatG * 9 + alcoholG * 7);
  const tolerance = calories * 0.10;

  if (Math.abs(calculated - calories) > tolerance) {
    return {
      valid: false,
      calculated,
      message: `Makro-kalori tutarsizligi: ${calories} kcal vs hesaplanan ${calculated} kcal`,
    };
  }

  return { valid: true, calculated, message: '' };
}

/**
 * Check for suspicious input (Spec 12.6).
 * Returns true if input seems abnormal and needs user confirmation.
 */
export function isSuspiciousInput(
  type: string,
  value: number,
  previousValue?: number
): { suspicious: boolean; message: string } {
  switch (type) {
    case 'weight': {
      if (previousValue && Math.abs(value - previousValue) / previousValue > 0.10) {
        return { suspicious: true, message: `${previousValue}kg'dan ${value}kg'a degisim buyuk, dogrula` };
      }
      if (value < 30 || value > 300) {
        return { suspicious: true, message: `${value}kg normal aralik disi` };
      }
      break;
    }
    case 'calories': {
      if (value > 5000) {
        return { suspicious: true, message: `${value} kcal cok yuksek, dogrula` };
      }
      break;
    }
    case 'water': {
      if (value > 6) {
        return { suspicious: true, message: `${value}L cok fazla, dogrula` };
      }
      break;
    }
    case 'sleep': {
      if (value > 14 || value < 2) {
        return { suspicious: true, message: `${value} saat uyku anormal, dogrula` };
      }
      break;
    }
  }
  return { suspicious: false, message: '' };
}

/**
 * Emergency detection (Spec 5.5).
 * If user describes serious symptoms, exit coaching mode.
 */
export function detectEmergency(text: string): { isEmergency: boolean; message: string } {
  const emergencyPhrases = [
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

  const lower = text.toLocaleLowerCase('tr');
  for (const phrase of emergencyPhrases) {
    if (lower.includes(phrase)) {
      return {
        isEmergency: true,
        message: 'Bu ciddi bir belirti. Lutfen HEMEN 112\'yi ara veya en yakin acil servise git. Ben yasam tarzi kocuyum, acil tibbi durumlar icin yetkim yok. Sagligin her seyden onemli.',
      };
    }
  }

  return { isEmergency: false, message: '' };
}

/**
 * Self-harm / suicide CRISIS detection (Spec 5.5 / 12.3).
 * This is DISTINCT from eating-disorder risk: a suicidal/self-harm message is an
 * acute psychological crisis and must receive an acute crisis response (immediate
 * emergency contact + professional help), NOT the eating-disorder dietitian/
 * psychologist referral. Must fire BEFORE detectEDRisk so these phrases can never
 * be answered with the milder ED message. We do NOT invent any hotline number —
 * 112 is Turkey's verified emergency line.
 */
export function detectCrisis(text: string): { isCrisis: boolean; message: string } {
  const lower = text.toLocaleLowerCase('tr');
  const crisisPhrases = [
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
  // FIX (audit guardrails_crisis): hybrid match — literal list PLUS root-based regex so
  // method-based ("kendimi asacağım", "bileğimi keseceğim") and indirect ("ölüp
  // kurtulmak istiyorum") phrasings still fire. Bias toward false-positive: an empathetic
  // crisis message is harmless, while a missed acute crisis is the highest-impact failure.
  // Diacritic-free variants are included so broken Turkish spelling still matches.
  const CRISIS_RE = [
    // FIX (audit regression): roots were bare substrings → false-positives ('kestane'⊃kes,
    // 'kıyma'⊃kıy, 'asansör'⊃as[a], 'doldur'⊃oldur). Constrain each to real self-harm verb
    // conjugations while preserving crisis recall (kıydım/astım/keseceğim still fire); the
    // literal phrase list above + the wrist/"ölüp kurtul" patterns below remain the safety net.
    // FIX (audit AI-GRD-01/CRITICAL): mastar/ulaç biçimleri eklendi — "kendimi asmak/asmayı/asmaya",
    // "kendimi kesmek/kesmeyi" gibi en doğal intihar ifadeleri yalnız çekimli (asacağım/astım)
    // biçimleri yakaladığı için kaçıyordu. Self-harm öznesi (kendimi/canımı/hayatımı) 30 karakter
    // içinde zorunlu olduğundan "asma katı"/"asma (üzüm)" gibi masum kullanımlar tetiklenmez.
    /(kendi(mi|me)|canı(mı|ma)|cani(mi|ma)|hayatı(mı|ma)|hayati(mi|ma)|yaşamı(mı|ma)|yasami(mi|ma)|her\s*şeye|her\s*seye).{0,30}(as(acağ|acak|tım|tim|arak|ıyor|iyor|mak|may|maya)|kes(ece|ece[kğ]|eceğ|erim|iyor|tim|tım|mek|meyi|meye)|kıy(mak|acağ|acak|dım|dim|dı|arım|arim|amam)|kiy(mak|acag|acak|dim|di|arim|amam)|son\s*ver|öldür|oldur|\boldur(mek|ece|eyim)|bitir(mek|ece|di|eyim)|veda|yok\s*et)/u,
    /(ölüp\s*kurtul|olup\s*kurtul|hayata\s*veda|son\s*vermek\s*isti|yaşamak\s*istemiyorum|yasamak\s*istemiyorum|yok\s*olmak\s*isti)/u,
    /(bilek|damar|bileği?mi|bilegimi).{0,15}(kes)/u,
    /(ip|bıçak|bicak|hap).{0,15}(kendi|canı|cani)/u,
  ];
  if (crisisPhrases.some(p => lower.includes(p)) || CRISIS_RE.some(r => r.test(lower))) {
    return {
      isCrisis: true,
      message: 'Soyledigin sey beni cok endiselendirdi ve bunu benimle paylastigin icin degerlisin. Yalniz degilsin. Lutfen su an guvende degilsen ya da kendine zarar verme dusuncen guicluyse HEMEN 112\'yi ara. Ayrica guvendigin birine — bir yakinina, bir doktora veya bir psikolog/psikiyatriste — hemen ulas; bu duygularla bas etmende profesyonel destek cok yardimci olur. Ben bir yasam tarzi kocuyum ve bu konuda profesyonel destegin yerini tutamam, ama senin icin gercekten endiseleniyorum. Hayatin cok degerli.',
    };
  }
  return { isCrisis: false, message: '' };
}

/**
 * Eating Disorder Risk Detection (Spec 12.5).
 * Detects potential eating disorder language and returns appropriate response.
 * NOTE: self-harm/suicide phrases live in detectCrisis (above), NOT here.
 */
export function detectEDRisk(text: string): { isRisk: boolean; severity: 'low' | 'medium' | 'high'; message: string } {
  const lower = text.toLocaleLowerCase('tr');

  // High severity — active purging
  const highPatterns = [
    'kusma', 'kustum', 'kusuyorum', 'kusmak istiyorum',
    'laksatif', 'müshil', 'mushil',
    'purging', 'binge and purge',
  ];
  for (const p of highPatterns) {
    if (lower.includes(p)) {
      return {
        isRisk: true,
        severity: 'high',
        message: 'Bu konuda sana yardimci olabilecek bir profesyonele ulasman cok onemli. Turkiye Yeme Bozukluklari Dernegi veya bir uzman psikolog ile gorusmenizi oneririm. Yalniz degilsin.',
      };
    }
  }

  // #live-L7: explicit dangerously-low calorie TARGET or aggressive rapid-loss intent.
  // These phrasings ("günde 500 kalori yemek istiyorum", "çok hızlı zayıflamak istiyorum")
  // matched no ED pattern, so the spec-required professional-support framing depended
  // entirely on the LLM (which omitted it). Make it deterministic.
  // FIX (audit AI-GRD-02): bare "yiyorum"/"yiyom" present-tense conjugations matched
  // none of the prior alternatives (only "ye"/"yiyec" roots), so "sadece 600 kalori
  // yiyorum" slipped past. Add the "yiyor" stem + common eating conjugations.
  const EATING_CTX = /(ye|yiyor|yedim|yiyom|yicem|yicek|öğün|ogun|yi?yec|yemek|alaca|alıyor|aliyor|gün(de)?|gun(de)?|diyet|beslen|tüket|tuket)/;
  const DEFICIT_CTX = /(açık|acik|defisit|yak|harca)/; // "500 kalori açık" is a deficit, not intake
  const kcalMatch = lower.match(/(\d{2,4})\s*(kalori|kcal|kal\b|cal\b)/);
  if (kcalMatch && !DEFICIT_CTX.test(lower)) {
    const kcal = parseInt(kcalMatch[1], 10);
    if (kcal > 0 && kcal < 1100 && EATING_CTX.test(lower)) {
      return {
        isRisk: true,
        severity: 'medium',
        message: 'Gunde bu kadar dusuk kalori (gunluk minimumun cok altinda) saglik icin riskli ve surdurulemez. Bu konuda bir uzman diyetisyen veya psikolog ile gorusmeni oneririm — saglikli ve kalici bir tempo icin birlikte daha guvenli bir plan kurabiliriz.',
      };
    }
  }
  if (/(cok hizli zayifla|çok hızlı zayıfla|hizlica zayifla|hızlıca zayıfla|cabuk zayifla|çabuk zayıfla|hemen zayifla|hemen zayıfla|acilen zayifla|acilen zayıfla|acil(en)? kilo ver|bir an once zayifla|bir an önce zayıfla)/.test(lower)) {
    return {
      isRisk: true,
      severity: 'medium',
      message: 'Cok hizli kilo verme istegini anliyorum ama saglikli kayip haftada 0.5-1 kg arasidir; daha hizlisi kas kaybi ve saglik riski getirir. Istersen bir uzman diyetisyen/psikolog destegiyle guvenli ve kalici bir plan kuralim.',
    };
  }

  // FIX (audit AI-GRD-03): literal "hiç yemiyorum" substrings missed "hiç yemek
  // yemiyorum" — the object ("yemek"/"bir şey") sits between "hiç" and "yemiyorum"
  // and breaks lower.includes(). Match with an optional-object regex instead.
  if (/hi[cç]\s*(bir\s*[sş]ey|yemek)?\s*yemiyorum/.test(lower) || /hi[cç]bir\s*[sş]ey\s*yemiyorum/.test(lower)) {
    return {
      isRisk: true,
      severity: 'medium',
      message: 'Anlattiklarin beni endiselendiiriyor. Bir uzman diyetisyen veya psikolog ile gorusmeni oneririm. Bu konuda profesyonel destek almak guclu bir adimdir.',
    };
  }

  // Medium severity — restrictive patterns
  const mediumPatterns = [
    'hic yemiyorum', 'hiç yemiyorum', 'hic bir sey yemiyorum', 'hicbir sey yemiyorum', 'hiçbir şey yemiyorum',
    'ac kalma', 'aç kalma', 'ac kalmak istiyorum', 'kendimi ac birakiyorum', 'kendimi aç bırakıyorum',
    'yeme bozukluğu', 'yeme bozuklugu',
    'anoreksiya', 'anorexia', 'bulimiya', 'bulimia',
    'yemek yemekten korkuyorum', 'yemekten nefret',
    'cok sismanim', 'çok şişmanım', 'sisman hissediyorum', 'kilolu hissediyorum',
    'igrenc gorunuyorum', 'iğrenç görünüyorum',
  ];
  for (const p of mediumPatterns) {
    if (lower.includes(p)) {
      return {
        isRisk: true,
        severity: 'medium',
        message: 'Anlattiklarin beni endiselendiiriyor. Bir uzman diyetisyen veya psikolog ile gorusmeni oneririm. Bu konuda profesyonel destek almak guclu bir adimdir.',
      };
    }
  }

  return { isRisk: false, severity: 'low', message: '' };
}

/**
 * Spec 5.26: Prompt Injection Protection
 * Detect and sanitize known injection patterns.
 * Returns sanitized text and whether injection was detected.
 */
const INJECTION_PATTERNS = [
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
  /sen\s+(artık|artik)\s+(bir|)/i,
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

export function sanitizeUserInput(text: string): {
  sanitized: string;
  injectionDetected: boolean;
} {
  // #live-L8: normalize Turkish diacritics + apostrophes so ASCII-written injection patterns
  // still match real Turkish input. Without this "Önceki tüm talimatları unut" and
  // "sistem prompt'unu yaz" slipped past the deterministic guard (diacritics + suffix
  // apostrophe). We test patterns against BOTH the raw and the normalized text.
  const normalized = text
    .toLocaleLowerCase('tr')
    .replace(/['’`´]/g, '')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/â/g, 'a');

  let injectionDetected = false;
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text) || pattern.test(normalized)) {
      injectionDetected = true;
      break;
    }
  }

  // Don't modify the text - let the system prompt handle it
  // But flag it so the response can be adjusted
  return { sanitized: text, injectionDetected };
}

/**
 * Exercise guardrail (Spec 12.2 extended).
 * Validates exercise parameters against safety thresholds.
 */
export function validateExercise(
  durationMin: number,
  intensity: string,
  sleepHours: number | null,
  consecutiveHardDays: number
): { safe: boolean; warnings: string[] } {
  const warnings: string[] = [];

  if (durationMin > MAX_WORKOUT_DURATION_MIN) {
    warnings.push(`${durationMin} dakika cok uzun, ${MAX_WORKOUT_DURATION_MIN} dakikayi gecmemesi onerilir`);
  }

  const isHighIntensity = ['high', 'yuksek', 'yogun', 'agir'].includes(
    intensity.toLocaleLowerCase('tr')
  );

  if (isHighIntensity && sleepHours !== null && sleepHours < 6) {
    warnings.push('Uyku azken yogun antrenman onerilmez');
  }

  if (consecutiveHardDays >= 3) {
    warnings.push('Arka arkaya yogun gunler, dinlenme gunu onerilir');
  }

  return {
    safe: warnings.length === 0,
    warnings,
  };
}

/**
 * Weight velocity guardrail.
 * Checks if weight loss rate is dangerously fast over 2-3 weeks.
 */
export function checkWeightVelocity(
  weights: { date: string; kg: number }[]
): { safe: boolean; warning: string | null; weeklyRate: number } {
  if (weights.length < 2) {
    return { safe: true, warning: null, weeklyRate: 0 };
  }

  // Sort by date ascending
  const sorted = [...weights].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Look at last 3 weeks of data
  const threeWeeksAgo = new Date();
  threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 21);
  const recent = sorted.filter(w => new Date(w.date) >= threeWeeksAgo);

  if (recent.length < 2) {
    return { safe: true, warning: null, weeklyRate: 0 };
  }

  const first = recent[0];
  const last = recent[recent.length - 1];
  const daysDiff = (new Date(last.date).getTime() - new Date(first.date).getTime()) / 86400000;

  if (daysDiff < 7) {
    return { safe: true, warning: null, weeklyRate: 0 };
  }

  const totalLoss = first.kg - last.kg; // positive = lost weight
  const weeks = daysDiff / 7;
  const weeklyRate = Math.round((totalLoss / weeks) * 100) / 100;

  // Hard cap: >1.0 kg/week over 2+ weeks is unsafe (Spec 12.1)
  if (weeklyRate > MAX_WEEKLY_LOSS_KG && weeks >= 2) {
    return {
      safe: false,
      warning: `Haftada ${weeklyRate}kg kayip spec maksimumunu (${MAX_WEEKLY_LOSS_KG}kg/hafta) asiyor. Saglikli kayip 0.5-1kg arasi olmalidir. Kaloriyi bakim seviyesine cikarmani oneririz.`,
      weeklyRate,
    };
  }

  return { safe: true, warning: null, weeklyRate };
}

export { MAX_WEEKLY_LOSS_KG, MAX_WORKOUT_DURATION_MIN };

// ─── Injury-based exercise filtering (Spec 12.2, 15.7) ───

/**
 * Body parts that an injury may affect, derived from free-text description.
 * Matches Turkish/English injury descriptions to body_part keys.
 */
const INJURY_KEYWORDS: Record<string, string[]> = {
  knee: ['diz', 'knee', 'menisc', 'menisk', 'acl', 'mcl'],
  back: ['sirt', 'sırt', 'bel', 'back', 'disc', 'disk', 'lomber', 'lumbar', 'fitik', 'fıtık'],
  shoulder: ['omuz', 'shoulder', 'rotator'],
  ankle: ['ayak bilegi', 'ayak bileği', 'bilek', 'ankle'],
  wrist: ['el bilegi', 'el bileği', 'wrist'],
  elbow: ['dirsek', 'elbow', 'tennis', 'golf kol'],
  hip: ['kalca', 'kalça', 'hip'],
  neck: ['boyun', 'neck', 'servikal'],
  hamstring: ['arka bacak', 'hamstring'],
  quad: ['on bacak', 'ön bacak', 'quad'],
  groin: ['kasik', 'kasık', 'adductor', 'groin'],
};

/**
 * Exercises mapped to the body parts they load heavily.
 * Used to filter out exercises that conflict with an active injury.
 */
const EXERCISE_BODY_PART_MAP: Record<string, string[]> = {
  // Knee-loading
  squat: ['knee', 'quad', 'hip'],
  'back squat': ['knee', 'quad', 'hip'],
  'front squat': ['knee', 'quad'],
  lunge: ['knee', 'quad', 'hip'],
  'bulgarian split': ['knee', 'quad'],
  'leg press': ['knee', 'quad'],
  'leg extension': ['knee', 'quad'],
  'leg curl': ['hamstring', 'knee'],
  'jump squat': ['knee', 'ankle'],
  'box jump': ['knee', 'ankle'],
  run: ['knee', 'ankle'],
  running: ['knee', 'ankle'],
  sprint: ['knee', 'ankle', 'hamstring'],
  'hill run': ['knee', 'ankle', 'hamstring'],

  // Back-loading
  deadlift: ['back', 'hamstring', 'hip'],
  'romanian deadlift': ['back', 'hamstring'],
  'good morning': ['back', 'hamstring'],
  'bent over row': ['back'],
  'barbell row': ['back'],
  'overhead press': ['back', 'shoulder'],

  // Shoulder-loading
  'bench press': ['shoulder', 'elbow'],
  'incline bench': ['shoulder', 'elbow'],
  'shoulder press': ['shoulder'],
  'military press': ['shoulder'],
  dip: ['shoulder', 'elbow'],
  'pull up': ['shoulder', 'elbow'],
  pullup: ['shoulder', 'elbow'],
  chinup: ['shoulder', 'elbow'],
  'lateral raise': ['shoulder'],

  // Ankle/wrist
  plank: ['wrist'],
  pushup: ['wrist', 'shoulder', 'elbow'],
  'push up': ['wrist', 'shoulder', 'elbow'],
  burpee: ['wrist', 'shoulder', 'ankle', 'knee'],

  // Hip/groin
  'hip thrust': ['hip'],
  'sumo deadlift': ['hip', 'groin', 'back'],

  // Turkish exercise names (#R2-7) — the coaching/plan model emits Turkish, so the
  // English-only map let injury-loading moves slip past the code-enforced filter.
  'çömelme': ['knee', 'quad', 'hip'],
  'comelme': ['knee', 'quad', 'hip'],
  'skuat': ['knee', 'quad', 'hip'],
  'hamle': ['knee', 'quad', 'hip'],
  'çökme': ['knee', 'quad', 'hip'],
  'koşu': ['knee', 'ankle'],
  'kosu': ['knee', 'ankle'],
  'koşma': ['knee', 'ankle'],
  'zıplama': ['knee', 'ankle'],
  'ziplama': ['knee', 'ankle'],
  'sıçrama': ['knee', 'ankle'],
  'sicrama': ['knee', 'ankle'],
  'şınav': ['wrist', 'shoulder', 'elbow'],
  'sinav': ['wrist', 'shoulder', 'elbow'],
  'mekik': ['back'],
  'göğüs pres': ['shoulder', 'elbow'],
  'gogus pres': ['shoulder', 'elbow'],
  'omuz pres': ['shoulder'],
  'ölü kaldırış': ['back', 'hamstring', 'hip'],
  'olu kaldiris': ['back', 'hamstring', 'hip'],
  'ölü kaldırma': ['back', 'hamstring', 'hip'],
  'barfiks': ['shoulder', 'elbow'],
  // FIX (audit AI-GRD-04): Turkish machine/compound leg names were missing, so a
  // coach writing "bacak presi yap" to a knee-injured user produced no conflict.
  'bacak presi': ['knee', 'quad'],
  'bacak pres': ['knee', 'quad'],
  'bacak ekstansiyon': ['knee', 'quad'],
  'bacak ekstansiyonu': ['knee', 'quad'],
  'bacak curl': ['hamstring', 'knee'],
  'arka bacak': ['hamstring', 'knee'],
};

/**
 * From free-text injury descriptions, extract affected body parts.
 */
export function extractInjuredBodyParts(descriptions: string[]): string[] {
  const affected = new Set<string>();
  for (const desc of descriptions) {
    const lower = desc.toLocaleLowerCase('tr');
    for (const [part, keywords] of Object.entries(INJURY_KEYWORDS)) {
      if (keywords.some(kw => lower.includes(kw))) {
        affected.add(part);
      }
    }
  }
  return Array.from(affected);
}

// ─── Equipment-aware exercise filtering (Spec 7.2, 15.1) ───

/**
 * Exercises that require specific equipment.
 * If user only has home equipment, we filter out gym-required lifts.
 */
const GYM_REQUIRED_EXERCISES: string[] = [
  'barbell', 'squat rack', 'bench press', 'incline bench', 'decline bench',
  'deadlift', 'leg press', 'leg curl', 'leg extension', 'cable',
  'lat pulldown', 'smith machine', 'hack squat', 'pec deck',
];

const HOME_ALTERNATIVES: Record<string, string> = {
  'bench press': 'pushup veya resistance band press',
  'barbell squat': 'goblet squat (dumbbell ile)',
  'back squat': 'goblet squat',
  'deadlift': 'single-leg deadlift (dumbbell ile)',
  'lat pulldown': 'pull-up veya resistance band pulldown',
  'leg press': 'bulgarian split squat',
  'leg curl': 'nordic curl veya glute bridge',
  'leg extension': 'wall sit',
  'cable row': 'resistance band row',
};

/**
 * Check if an exercise requires gym equipment.
 */
export function requiresGymEquipment(exerciseName: string): boolean {
  const lower = exerciseName.toLocaleLowerCase('tr');
  return GYM_REQUIRED_EXERCISES.some(kw => lower.includes(kw));
}

/**
 * Filter exercise list by available equipment.
 * Returns safe list + excluded-with-alternative suggestions.
 */
export function filterExercisesByEquipment(
  exercises: string[],
  equipmentAccess: string | null
): { safe: string[]; excluded: { exercise: string; alternative: string | null }[] } {
  if (!equipmentAccess || equipmentAccess === 'gym' || equipmentAccess === 'both') {
    return { safe: exercises, excluded: [] };
  }
  // equipment_access === 'home' — filter out gym-required lifts
  const safe: string[] = [];
  const excluded: { exercise: string; alternative: string | null }[] = [];

  for (const ex of exercises) {
    if (requiresGymEquipment(ex)) {
      const lower = ex.toLocaleLowerCase('tr');
      const alt = Object.entries(HOME_ALTERNATIVES).find(([k]) => lower.includes(k));
      excluded.push({ exercise: ex, alternative: alt ? alt[1] : null });
    } else {
      safe.push(ex);
    }
  }

  return { safe, excluded };
}

/**
 * Output-side safety scan (Spec 12.2): find exercise names mentioned in a
 * FREE-TEXT reply that load the user's injured body parts. Chat advice has no
 * exercise array to run filterExercisesByInjury over, so scan the prose.
 */
export function findInjuryConflictsInText(
  text: string,
  injuredBodyParts: string[],
): string[] {
  if (injuredBodyParts.length === 0 || !text) return [];
  const lower = text.toLocaleLowerCase('tr');
  const conflicts = new Set<string>();
  for (const [pattern, bodyParts] of Object.entries(EXERCISE_BODY_PART_MAP)) {
    if (proseMentionsExercise(lower, pattern) && bodyParts.some(bp => injuredBodyParts.includes(bp))) {
      conflicts.add(pattern);
    }
  }
  return Array.from(conflicts);
}

/**
 * Word-START-boundary match for scanning FREE-TEXT prose (not structured exercise names).
 * Naive substring matching produced dangerous false positives on short ASCII patterns: 'run'
 * matched Turkish "sorun"/"sorunsuz"/"vurun" (problem/hit), 'dip' matched "dipnot", so a
 * knee-injured user got nagged about running on nearly every reply. We require the pattern to
 * begin a word (preceding char is a non-Turkish-letter or string start) but still allow any
 * Turkish suffix AFTER it, so inflections stay matched ("koşu" in "koşuyu", "squat" in "squatları").
 */
const TR_LETTER = /[a-zçğıöşü0-9]/;
function proseMentionsExercise(lower: string, pattern: string): boolean {
  let from = 0;
  let i = lower.indexOf(pattern, from);
  while (i >= 0) {
    const before = i > 0 ? lower[i - 1] : '';
    if (!TR_LETTER.test(before)) return true; // word start → real mention
    from = i + 1;
    i = lower.indexOf(pattern, from);
  }
  return false;
}

/**
 * Filter an exercise list to remove ones that load any of the injured body parts.
 * Returns { safe, excluded } so caller can inform the user what was removed.
 */
export function filterExercisesByInjury(
  exercises: string[],
  injuredBodyParts: string[]
): { safe: string[]; excluded: { exercise: string; bodyParts: string[] }[] } {
  if (injuredBodyParts.length === 0) {
    return { safe: exercises, excluded: [] };
  }
  const safe: string[] = [];
  const excluded: { exercise: string; bodyParts: string[] }[] = [];

  for (const ex of exercises) {
    const lower = ex.toLocaleLowerCase('tr');
    let hit: string[] | null = null;
    for (const [pattern, bodyParts] of Object.entries(EXERCISE_BODY_PART_MAP)) {
      if (lower.includes(pattern)) {
        const conflicts = bodyParts.filter(bp => injuredBodyParts.includes(bp));
        if (conflicts.length > 0) {
          hit = conflicts;
          break;
        }
      }
    }
    if (hit) {
      excluded.push({ exercise: ex, bodyParts: hit });
    } else {
      safe.push(ex);
    }
  }

  return { safe, excluded };
}
