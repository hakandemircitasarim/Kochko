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
