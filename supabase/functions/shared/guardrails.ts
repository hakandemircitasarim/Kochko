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
export function sanitizeText(text: string): { clean: string; hadViolations: boolean } {
  let clean = text;
  let hadViolations = false;

  for (const phrase of FORBIDDEN_PHRASES) {
    const regex = new RegExp(phrase, 'gi');
    if (regex.test(clean)) {
      hadViolations = true;
      clean = clean.replace(regex, '[yasam tarzi notu]');
    }
  }

  return { clean, hadViolations };
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
    'gogus agrisi', 'göğüs ağrısı', 'nefes alamıyorum', 'nefes alamiyorum',
    'bayiliyorum', 'bayılıyorum', 'kalp krizi', 'felc', 'felç',
    'kan kusuyorum', 'bilincimi kaybediyorum',
  ];

  const lower = text.toLocaleLowerCase('tr');
  for (const phrase of emergencyPhrases) {
    if (lower.includes(phrase)) {
      return {
        isEmergency: true,
        message: 'Ciddi bir saglik belirtisi anlattın. Lütfen hemen 112\'yi ara. Ben yasam tarzi kocuyum, acil tibbi durumlar icin yetkim yok.',
      };
    }
  }

  return { isEmergency: false, message: '' };
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
