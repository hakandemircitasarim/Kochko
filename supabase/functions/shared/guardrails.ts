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
const FORBIDDEN_PHRASES = [
  'teshis', 'teşhis', 'tani koy', 'tanı koy', 'tedavi', 'hastalık', 'hastalik',
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
 * Check AI-generated meal suggestions against user's allergen list.
 * This is a CODE-BASED guardrail (Spec 12.4).
 */
export function checkAllergens(
  mealText: string,
  allergens: string[]
): AllergenCheck {
  if (allergens.length === 0) return { passed: true, violations: [] };

  const lowerText = mealText.toLocaleLowerCase('tr');
  const violations = allergens.filter(a => lowerText.includes(a.toLocaleLowerCase('tr')));

  return {
    passed: violations.length === 0,
    violations: violations.map(v => `ALERJEN TESPIT: "${v}" plan/oneride bulundu`),
  };
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
 * Eating Disorder Risk Detection (Spec 12.5).
 * Detects potential eating disorder language and returns appropriate response.
 */
export function detectEDRisk(text: string): { isRisk: boolean; severity: 'low' | 'medium' | 'high'; message: string } {
  const lower = text.toLocaleLowerCase('tr');

  // High severity — active purging/self-harm
  const highPatterns = [
    'kusma', 'kustum', 'kusuyorum', 'kusmak istiyorum',
    'laksatif', 'müshil', 'mushil',
    'kendime zarar', 'intihar', 'olmek istiyorum', 'ölmek istiyorum',
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

  // Medium severity — restrictive patterns
  const mediumPatterns = [
    'hic yemiyorum', 'hiç yemiyorum', 'hic bir sey yemiyorum',
    'ac kalma', 'aç kalma', 'ac kalmak istiyorum',
    'yeme bozukluğu', 'yeme bozuklugu',
    'anoreksiya', 'anorexia', 'bulimiya', 'bulimia',
    'yemek yemekten korkuyorum', 'yemekten nefret',
    'cok sismansim', 'çok şişmanım', 'igrenc gorunuyorum', 'iğrenç görünüyorum',
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
  /onceki\s+talimatlari\s+(unut|yoksay)/i,
];

export function sanitizeUserInput(text: string): {
  sanitized: string;
  injectionDetected: boolean;
} {
  let injectionDetected = false;

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
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

  // Check if losing more than 1.5 kg/week over 2+ weeks
  if (weeklyRate > 1.5 && weeks >= 2) {
    return {
      safe: false,
      warning: `Haftada ${weeklyRate}kg kayip cok hizli. Saglikli kayip haftada 0.5-1kg arasi olmalidir. Daha yavas ilerlemenizi oneririz.`,
      weeklyRate,
    };
  }

  return { safe: true, warning: null, weeklyRate };
}
