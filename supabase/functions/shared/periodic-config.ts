/**
 * Periodic State Configuration (Server-side)
 * Spec 9: Defines how each periodic state affects nutrition, workout, and AI behavior.
 * NOTE: Client-side mirror exists in src/services/periodic.service.ts — keep in sync.
 */

export type PeriodicState = 'ramadan' | 'holiday' | 'illness' | 'busy_work' | 'exam' | 'pregnancy' | 'breastfeeding' | 'injury' | 'travel' | 'custom';

export interface PeriodicStateConfig {
  calorieAdjustment: number;        // kcal delta (e.g., +300 for pregnancy T2)
  proteinMultiplier: number;        // e.g., 1.1 = +10%
  workoutIntensityMax: 'low' | 'moderate' | 'high';
  ifCompatible: boolean;
  waterMultiplier: number;          // e.g., 1.2 = +20%
  requiresEndDate: boolean;
  maxDurationDays: number | null;
  label_tr: string;
  description_tr: string;
}

export const PERIODIC_STATE_CONFIG: Record<PeriodicState, PeriodicStateConfig> = {
  ramadan: {
    calorieAdjustment: -150,
    proteinMultiplier: 1.0,
    workoutIntensityMax: 'moderate',
    ifCompatible: false, // Ramadan has its own eating window
    waterMultiplier: 1.3,
    requiresEndDate: true,
    maxDurationDays: 30,
    label_tr: 'Ramazan',
    description_tr: 'Ogunler iftar-sahur penceresine sigdirilir, antrenman yogunlugu dusurulur.',
  },
  holiday: {
    calorieAdjustment: 0,
    proteinMultiplier: 1.0,
    workoutIntensityMax: 'high',
    ifCompatible: true,
    waterMultiplier: 1.0,
    requiresEndDate: true,
    maxDurationDays: 30,
    label_tr: 'Tatil',
    description_tr: 'Esneklik modu: kalori araligi genisler, guilt-free yaklasim.',
  },
  illness: {
    calorieAdjustment: 0, // Maintenance calories (no deficit)
    proteinMultiplier: 1.0,
    workoutIntensityMax: 'low',
    ifCompatible: false,
    waterMultiplier: 1.2,
    requiresEndDate: false,
    maxDurationDays: 30,
    label_tr: 'Hastalik',
    description_tr: 'Kalori acigi kaldirilir, IF durdurulur, sadece hafif aktivite.',
  },
  busy_work: {
    calorieAdjustment: 0,
    proteinMultiplier: 1.0,
    workoutIntensityMax: 'moderate',
    ifCompatible: true,
    waterMultiplier: 1.0,
    requiresEndDate: true,
    maxDurationDays: 60,
    label_tr: 'Yogun Is Donemi',
    description_tr: 'Basit ve hizli ogunler onerilir, kisa antrenmanlar.',
  },
  exam: {
    calorieAdjustment: 0,
    proteinMultiplier: 1.0,
    workoutIntensityMax: 'moderate',
    ifCompatible: true,
    waterMultiplier: 1.0,
    requiresEndDate: true,
    maxDurationDays: 60,
    label_tr: 'Sinav Donemi',
    description_tr: 'Beyin besinleri on planda, stres yeme uyarisi aktif.',
  },
  pregnancy: {
    calorieAdjustment: 300, // Average across trimesters
    proteinMultiplier: 1.1,
    workoutIntensityMax: 'moderate',
    ifCompatible: false,
    waterMultiplier: 1.1,
    requiresEndDate: true,
    maxDurationDays: 280,
    label_tr: 'Hamilelik',
    description_tr: 'IF durdurulur, kalori artirilir, yasak besinler filtrelenir.',
  },
  breastfeeding: {
    calorieAdjustment: 500,
    proteinMultiplier: 1.2,
    workoutIntensityMax: 'moderate',
    ifCompatible: false,
    waterMultiplier: 1.3,
    requiresEndDate: false,
    maxDurationDays: null,
    label_tr: 'Emzirme',
    description_tr: 'Kalori +500, IF durdurulur, su hedefi artirilir.',
  },
  injury: {
    calorieAdjustment: -100,
    proteinMultiplier: 1.1,
    workoutIntensityMax: 'low',
    ifCompatible: true,
    waterMultiplier: 1.0,
    requiresEndDate: false,
    maxDurationDays: 90,
    label_tr: 'Sakatlik',
    description_tr: 'Etkilenen bolge antrenman disi, protein artirilir.',
  },
  travel: {
    calorieAdjustment: 0,
    proteinMultiplier: 1.0,
    workoutIntensityMax: 'high',
    ifCompatible: true,
    waterMultiplier: 1.1,
    requiresEndDate: true,
    maxDurationDays: 90,
    label_tr: 'Seyahat',
    description_tr: 'Esneklik modu, lokal yiyecek kesfetme, donus plani.',
  },
  custom: {
    calorieAdjustment: 0,
    proteinMultiplier: 1.0,
    workoutIntensityMax: 'high',
    ifCompatible: true,
    waterMultiplier: 1.0,
    requiresEndDate: false,
    maxDurationDays: null,
    label_tr: 'Ozel Durum',
    description_tr: 'Kullanici tanimli ozel donem.',
  },
};

// ─── Utility Functions ───

export function getPeriodicCalorieAdjustment(state: PeriodicState | null | undefined): number {
  if (!state) return 0;
  return PERIODIC_STATE_CONFIG[state]?.calorieAdjustment ?? 0;
}

export function getPeriodicProteinMultiplier(state: PeriodicState | null | undefined): number {
  if (!state) return 1.0;
  return PERIODIC_STATE_CONFIG[state]?.proteinMultiplier ?? 1.0;
}

export function isIFCompatible(state: PeriodicState | null | undefined): boolean {
  if (!state) return true;
  return PERIODIC_STATE_CONFIG[state]?.ifCompatible ?? true;
}

export function getPeriodicWaterMultiplier(state: PeriodicState | null | undefined): number {
  if (!state) return 1.0;
  return PERIODIC_STATE_CONFIG[state]?.waterMultiplier ?? 1.0;
}

export function getPeriodicWorkoutCap(state: PeriodicState | null | undefined): string {
  if (!state) return 'high';
  return PERIODIC_STATE_CONFIG[state]?.workoutIntensityMax ?? 'high';
}

// ─── Plan Context Builder ───

export function buildPeriodicPlanContext(profile: {
  periodic_state?: string | null;
  periodic_state_start?: string | null;
  periodic_state_end?: string | null;
  if_active?: boolean;
  gender?: string | null;
}): string {
  const state = profile.periodic_state as PeriodicState | null;
  if (!state) return '';

  const config = PERIODIC_STATE_CONFIG[state];
  if (!config) return '';

  const parts: string[] = [];
  parts.push(`\n*** DONEMSEL AYARLAMALAR (${config.label_tr}) ***`);

  if (config.calorieAdjustment !== 0) {
    const sign = config.calorieAdjustment > 0 ? '+' : '';
    parts.push(`Kalori: ${sign}${config.calorieAdjustment} kcal`);
  }
  if (config.proteinMultiplier !== 1.0) {
    parts.push(`Protein: x${config.proteinMultiplier}`);
  }
  if (config.workoutIntensityMax !== 'high') {
    parts.push(`Antrenman: maksimum ${config.workoutIntensityMax} yogunluk`);
  }
  if (!config.ifCompatible && profile.if_active) {
    parts.push('IF: Bu donemde uyumlu degil, YOKSAY');
  }
  if (config.waterMultiplier !== 1.0) {
    parts.push(`Su: x${config.waterMultiplier}`);
  }

  // Transition info
  if (profile.periodic_state_end) {
    const end = new Date(profile.periodic_state_end);
    const today = new Date();
    const daysLeft = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 3 && daysLeft > 0) {
      parts.push(`GECIS: ${daysLeft} gun icinde donem bitiyor, gecis plani hazirla`);
    } else if (daysLeft <= 0) {
      parts.push('GECIS: Donem suresi doldu, normale donus plani olustur');
    }
  }

  return parts.join('\n');
}

// ─── Seasonal Context ───

// Ramadan dates (approximate, based on Islamic calendar lunar shift)
const RAMADAN_DATES: Record<number, { start: string; end: string }> = {
  2025: { start: '2025-02-28', end: '2025-03-30' },
  2026: { start: '2026-02-17', end: '2026-03-19' },
  2027: { start: '2027-02-07', end: '2027-03-08' },
  2028: { start: '2028-01-27', end: '2028-02-25' },
  2029: { start: '2029-01-15', end: '2029-02-13' },
  2030: { start: '2030-01-05', end: '2030-02-03' },
};

export interface SeasonalContext {
  season: 'winter' | 'spring' | 'summer' | 'fall';
  isRamadan: boolean;
  ramadanDaysLeft: number | null;
  isRamadanApproaching: boolean; // within 7 days
  suggestions_tr: string[];
}

export function getSeasonalContext(): SeasonalContext {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const year = now.getFullYear();

  // Season
  let season: SeasonalContext['season'];
  if (month >= 3 && month <= 5) season = 'spring';
  else if (month >= 6 && month <= 8) season = 'summer';
  else if (month >= 9 && month <= 11) season = 'fall';
  else season = 'winter';

  // Ramadan check
  const ramadan = RAMADAN_DATES[year];
  let isRamadan = false;
  let ramadanDaysLeft: number | null = null;
  let isRamadanApproaching = false;

  if (ramadan) {
    const rStart = new Date(ramadan.start);
    const rEnd = new Date(ramadan.end);
    const todayStr = now.toISOString().split('T')[0];

    if (todayStr >= ramadan.start && todayStr <= ramadan.end) {
      isRamadan = true;
      ramadanDaysLeft = Math.ceil((rEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    } else {
      const daysToStart = Math.ceil((rStart.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysToStart > 0 && daysToStart <= 7) {
        isRamadanApproaching = true;
      }
    }
  }

  // Seasonal suggestions
  const suggestions_tr: string[] = [];
  switch (season) {
    case 'summer':
      suggestions_tr.push('Salata ve soguk corbalar', 'Bol su ve meyve', 'Hafif proteinler (tavuk, balik)');
      break;
    case 'winter':
      suggestions_tr.push('Sicak corbalar ve yahniler', 'Kuru baklagiller', 'Sicak ickecekler (bitki cayi)');
      break;
    case 'spring':
      suggestions_tr.push('Taze yesil sebzeler', 'Mevsim meyveleri', 'Hafif ve dengeli ogunler');
      break;
    case 'fall':
      suggestions_tr.push('Kabak ve kok sebzeler', 'Balik mevsimi', 'Sicak kahvaltilar');
      break;
  }

  return { season, isRamadan, ramadanDaysLeft, isRamadanApproaching, suggestions_tr };
}
