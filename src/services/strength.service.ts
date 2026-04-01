/**
 * Strength Training Progression Service
 * Spec 7.5: Güç antrenmanı progresyon sistemi
 * Set-rep-weight tracking, 1RM estimation, deload management.
 */
import { supabase } from '@/lib/supabase';

export interface StrengthSet {
  id: string;
  exercise_name: string;
  set_number: number;
  reps: number;
  weight_kg: number;
  is_pr: boolean;
}

export interface ExerciseHistory {
  exercise: string;
  estimated1RM: number;
  lastWeight: number;
  lastReps: number;
  history: { date: string; weight_kg: number; reps: number; sets: number }[];
  weeksSinceDeload: number;
}

/**
 * Estimate 1RM using Epley formula.
 * 1RM = weight × (1 + reps/30)
 */
export function estimate1RM(weight: number, reps: number): number {
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

/**
 * Get exercise history for a specific movement.
 */
export async function getExerciseHistory(
  userId: string,
  exerciseName: string,
  weeks: number = 8
): Promise<ExerciseHistory | null> {
  const fromDate = new Date(Date.now() - weeks * 7 * 86400000).toISOString().split('T')[0];

  const { data: workouts } = await supabase
    .from('workout_logs')
    .select('id, logged_for_date')
    .eq('user_id', userId)
    .gte('logged_for_date', fromDate)
    .order('logged_for_date');

  if (!workouts?.length) return null;

  const workoutIds = workouts.map((w: { id: string }) => w.id);
  const { data: sets } = await supabase
    .from('strength_sets')
    .select('workout_log_id, set_number, reps, weight_kg')
    .in('workout_log_id', workoutIds)
    .eq('exercise_name', exerciseName)
    .order('set_number');

  if (!sets?.length) return null;

  // Group by workout date
  const byDate: Record<string, { weight_kg: number; reps: number; sets: number }> = {};
  for (const s of sets as { workout_log_id: string; reps: number; weight_kg: number }[]) {
    const workout = workouts.find((w: { id: string }) => w.id === s.workout_log_id) as { logged_for_date: string } | undefined;
    if (!workout) continue;
    const date = workout.logged_for_date;
    if (!byDate[date]) byDate[date] = { weight_kg: s.weight_kg, reps: s.reps, sets: 0 };
    byDate[date].sets++;
    if (s.weight_kg > byDate[date].weight_kg) {
      byDate[date].weight_kg = s.weight_kg;
      byDate[date].reps = s.reps;
    }
  }

  const history = Object.entries(byDate).map(([date, data]) => ({ date, ...data }));
  const latest = history[history.length - 1];
  const estimated = estimate1RM(latest.weight_kg, latest.reps);

  return {
    exercise: exerciseName,
    estimated1RM: estimated,
    lastWeight: latest.weight_kg,
    lastReps: latest.reps,
    history,
    weeksSinceDeload: history.length > 0
      ? Math.round((Date.now() - new Date(history[0].date).getTime()) / (7 * 24 * 60 * 60 * 1000))
      : 0,
  };
}

/**
 * Suggest next workout targets based on progressive overload.
 * Spec 7.5: 2 consecutive successes → increase weight.
 */
export function suggestProgression(
  lastWeight: number,
  lastReps: number,
  targetReps: number,
  consecutiveSuccesses: number
): { weight: number; reps: number; note: string } {
  if (consecutiveSuccesses >= 2 && lastReps >= targetReps) {
    // Increase weight by 2.5kg (standard progression)
    return {
      weight: lastWeight + 2.5,
      reps: targetReps,
      note: `2 ardisik basari! Agirligi ${lastWeight}kg -> ${lastWeight + 2.5}kg cikiyoruz.`,
    };
  }

  if (lastReps < targetReps) {
    // Couldn't hit target reps, stay same weight
    return {
      weight: lastWeight,
      reps: targetReps,
      note: `Hedef ${targetReps} rep'e ulasamadin, ayni agirlikta devam.`,
    };
  }

  return {
    weight: lastWeight,
    reps: targetReps,
    note: 'Devam et, bir sonrakinde agirligi artirabilirsin.',
  };
}

/**
 * Check if deload is needed (Spec 7.5: 4-6 hafta sonra otomatik deload önerisi).
 */
export function shouldDeload(weeksSinceDeload: number): { needed: boolean; message: string } {
  if (weeksSinceDeload >= 6) {
    return { needed: true, message: '6+ haftadir agir calisiyorsun. Deload haftasi zamanı - ayni hareketler, %60-70 agirlik, dusuk set.' };
  }
  if (weeksSinceDeload >= 4) {
    return { needed: false, message: '4 hafta oldu, 1-2 hafta sonra deload dusunebiliriz.' };
  }
  return { needed: false, message: '' };
}

// ─── FAZ 3: Volume, RPE, Plateau, Variation, Periodization, Fatigue ───

/**
 * Calculate total training volume = sum(reps x weight) for a set of sets.
 */
export function calculateVolume(sets: { reps: number; weight_kg: number }[]): number {
  return sets.reduce((total, s) => total + s.reps * s.weight_kg, 0);
}

/**
 * Get weekly volume progression for an exercise over N weeks.
 * Returns array of { week, weekStart, volume } for trend analysis.
 */
export async function getVolumeProgression(
  userId: string,
  exerciseName: string,
  weeks: number = 8
): Promise<{ week: number; weekStart: string; volume: number }[]> {
  const fromDate = new Date(Date.now() - weeks * 7 * 86400000).toISOString().split('T')[0];

  const { data: workouts } = await supabase
    .from('workout_logs')
    .select('id, logged_for_date')
    .eq('user_id', userId)
    .gte('logged_for_date', fromDate)
    .order('logged_for_date');

  if (!workouts?.length) return [];

  const workoutIds = workouts.map((w: { id: string }) => w.id);
  const { data: sets } = await supabase
    .from('strength_sets')
    .select('workout_log_id, reps, weight_kg')
    .in('workout_log_id', workoutIds)
    .eq('exercise_name', exerciseName);

  if (!sets?.length) return [];

  // Map workout_log_id -> date
  const workoutDateMap: Record<string, string> = {};
  for (const w of workouts as { id: string; logged_for_date: string }[]) {
    workoutDateMap[w.id] = w.logged_for_date;
  }

  // Group volume by ISO week
  const weeklyVolume: Record<string, number> = {};
  for (const s of sets as { workout_log_id: string; reps: number; weight_kg: number }[]) {
    const date = workoutDateMap[s.workout_log_id];
    if (!date) continue;
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const weekStart = new Date(d.setDate(diff)).toISOString().split('T')[0];
    weeklyVolume[weekStart] = (weeklyVolume[weekStart] ?? 0) + s.reps * s.weight_kg;
  }

  const sorted = Object.entries(weeklyVolume).sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([weekStart, volume], i) => ({ week: i + 1, weekStart, volume }));
}

/**
 * Track RPE (Rate of Perceived Exertion) across sets.
 * Returns average RPE and whether any set exceeded RPE 9.
 */
export function trackRPE(sets: { rpe?: number }[]): {
  averageRPE: number | null;
  highExertionWarning: boolean;
  setsAbove9: number;
} {
  const withRPE = sets.filter(s => s.rpe != null && s.rpe !== undefined);
  if (withRPE.length === 0) {
    return { averageRPE: null, highExertionWarning: false, setsAbove9: 0 };
  }

  const total = withRPE.reduce((sum, s) => sum + s.rpe!, 0);
  const avg = Math.round((total / withRPE.length) * 10) / 10;
  const setsAbove9 = withRPE.filter(s => s.rpe! > 9).length;

  return {
    averageRPE: avg,
    highExertionWarning: setsAbove9 > 0,
    setsAbove9,
  };
}

/**
 * Detect plateau for a specific exercise.
 * If max weight hasn't increased for 4+ consecutive weeks -> plateau.
 */
export async function detectPlateauByExercise(
  userId: string,
  exerciseName: string
): Promise<{ plateau: boolean; weeks: number; maxWeight: number; message: string }> {
  const history = await getExerciseHistory(userId, exerciseName, 12);
  if (!history || history.history.length < 4) {
    return { plateau: false, weeks: 0, maxWeight: 0, message: 'Yeterli veri yok.' };
  }

  // Group by week and find max weight per week
  const weeklyMax: { weekStart: string; maxWeight: number }[] = [];
  const byWeek: Record<string, number> = {};
  for (const entry of history.history) {
    const d = new Date(entry.date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const weekStart = new Date(d.setDate(diff)).toISOString().split('T')[0];
    byWeek[weekStart] = Math.max(byWeek[weekStart] ?? 0, entry.weight_kg);
  }

  const sortedWeeks = Object.entries(byWeek)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, maxWeight]) => ({ weekStart, maxWeight }));

  if (sortedWeeks.length < 4) {
    return { plateau: false, weeks: 0, maxWeight: 0, message: 'Yeterli hafta yok.' };
  }

  // Check trailing weeks for unchanged max weight
  let plateauWeeks = 1;
  const latestMax = sortedWeeks[sortedWeeks.length - 1].maxWeight;
  for (let i = sortedWeeks.length - 2; i >= 0; i--) {
    if (sortedWeeks[i].maxWeight >= latestMax) {
      plateauWeeks++;
    } else {
      break;
    }
  }

  const isPlateau = plateauWeeks >= 4;
  return {
    plateau: isPlateau,
    weeks: plateauWeeks,
    maxWeight: latestMax,
    message: isPlateau
      ? `${exerciseName} icin ${plateauWeeks} haftadir ${latestMax}kg'da takildin. Varyasyon veya deload dene.`
      : `${exerciseName} ilerliyor, son max: ${latestMax}kg.`,
  };
}

/**
 * Suggest alternative exercises for a given movement.
 */
export function suggestVariation(exerciseName: string): {
  alternatives: string[];
  message: string;
} {
  const VARIATION_MAP: Record<string, string[]> = {
    'bench press': ['dumbbell press', 'incline bench press', 'floor press'],
    'bench': ['dumbbell press', 'incline bench press', 'floor press'],
    'squat': ['front squat', 'leg press', 'goblet squat'],
    'back squat': ['front squat', 'leg press', 'goblet squat'],
    'deadlift': ['romanian deadlift', 'trap bar deadlift', 'good morning'],
    'overhead press': ['arnold press', 'landmine press', 'push press'],
    'military press': ['arnold press', 'landmine press', 'push press'],
    'barbell row': ['cable row', 'dumbbell row', 't-bar row'],
    'bent over row': ['cable row', 'dumbbell row', 't-bar row'],
    'row': ['cable row', 'dumbbell row', 't-bar row'],
    'pull up': ['lat pulldown', 'chin up', 'band-assisted pull up'],
    'chin up': ['lat pulldown', 'pull up', 'cable row'],
    'dip': ['close grip bench press', 'tricep pushdown', 'diamond push up'],
    'lunge': ['bulgarian split squat', 'step up', 'walking lunge'],
    'leg curl': ['nordic curl', 'swiss ball curl', 'romanian deadlift'],
    'leg extension': ['sissy squat', 'front squat', 'wall sit'],
    'bicep curl': ['hammer curl', 'incline curl', 'concentration curl'],
    'tricep extension': ['skull crusher', 'close grip bench press', 'dip'],
    'lateral raise': ['cable lateral raise', 'upright row', 'face pull'],
    'face pull': ['reverse fly', 'band pull apart', 'rear delt fly'],
    'hip thrust': ['glute bridge', 'cable pull through', 'sumo deadlift'],
    'calf raise': ['seated calf raise', 'donkey calf raise', 'jump rope'],
  };

  const key = exerciseName.toLowerCase().trim();
  const alternatives = VARIATION_MAP[key];

  if (alternatives) {
    return {
      alternatives,
      message: `${exerciseName} yerine dene: ${alternatives.join(', ')}.`,
    };
  }

  // Fuzzy match: check if the exercise name contains any key
  for (const [mapKey, alts] of Object.entries(VARIATION_MAP)) {
    if (key.includes(mapKey) || mapKey.includes(key)) {
      return {
        alternatives: alts,
        message: `${exerciseName} yerine dene: ${alts.join(', ')}.`,
      };
    }
  }

  return {
    alternatives: [],
    message: `${exerciseName} icin alternatif bulunamadi.`,
  };
}

/**
 * Periodization block info.
 * Returns current block parameters and next block suggestion.
 */
export function generatePeriodization(
  currentBlock: 'hypertrophy' | 'strength' | 'deload' | 'peak',
  weeksInBlock: number
): {
  current: { block: string; weekRange: number; repRange: string; rpeRange: string; intensityNote: string };
  isBlockComplete: boolean;
  nextBlock: string;
  message: string;
} {
  const BLOCKS: Record<string, { duration: number; repRange: string; rpeRange: string; intensityNote: string }> = {
    hypertrophy: { duration: 4, repRange: '8-12', rpeRange: '7-8', intensityNote: 'Orta agirlik, yuksek hacim. Kas buyumesi odakli.' },
    strength:    { duration: 4, repRange: '3-6',  rpeRange: '8-9', intensityNote: 'Agir agirlik, dusuk hacim. Guc artisi odakli.' },
    deload:      { duration: 1, repRange: '8-12', rpeRange: '5-6', intensityNote: 'Normal agirliklarin %60\'i. Toparlanma haftasi.' },
    peak:        { duration: 1, repRange: '1-3',  rpeRange: '9-10', intensityNote: 'Maksimum agirlik, minimalist hacim. Test haftasi.' },
  };

  const BLOCK_ORDER: Record<string, string> = {
    hypertrophy: 'strength',
    strength: 'deload',
    deload: 'peak',
    peak: 'hypertrophy',
  };

  const blockInfo = BLOCKS[currentBlock];
  const isComplete = weeksInBlock >= blockInfo.duration;
  const nextBlock = BLOCK_ORDER[currentBlock];

  return {
    current: {
      block: currentBlock,
      weekRange: blockInfo.duration,
      repRange: blockInfo.repRange,
      rpeRange: blockInfo.rpeRange,
      intensityNote: blockInfo.intensityNote,
    },
    isBlockComplete: isComplete,
    nextBlock,
    message: isComplete
      ? `${currentBlock} blogu tamamlandi (${weeksInBlock}/${blockInfo.duration} hafta). Siradaki: ${nextBlock} blogu.`
      : `${currentBlock} blogu devam ediyor (${weeksInBlock}/${blockInfo.duration} hafta). Rep: ${blockInfo.repRange}, RPE: ${blockInfo.rpeRange}.`,
  };
}

/**
 * Map of exercises to primary and secondary muscle groups.
 */
export const EXERCISE_MUSCLE_MAP: Record<string, { primary: string[]; secondary: string[] }> = {
  'bench press':       { primary: ['chest'],       secondary: ['triceps', 'front delts'] },
  'incline bench press': { primary: ['upper chest'], secondary: ['triceps', 'front delts'] },
  'dumbbell press':    { primary: ['chest'],       secondary: ['triceps', 'front delts'] },
  'floor press':       { primary: ['chest', 'triceps'], secondary: ['front delts'] },
  'squat':             { primary: ['quads', 'glutes'], secondary: ['hamstrings', 'core'] },
  'front squat':       { primary: ['quads'],       secondary: ['core', 'upper back'] },
  'goblet squat':      { primary: ['quads', 'glutes'], secondary: ['core'] },
  'leg press':         { primary: ['quads', 'glutes'], secondary: ['hamstrings'] },
  'deadlift':          { primary: ['hamstrings', 'glutes', 'lower back'], secondary: ['traps', 'forearms'] },
  'romanian deadlift': { primary: ['hamstrings', 'glutes'], secondary: ['lower back'] },
  'trap bar deadlift': { primary: ['quads', 'glutes', 'hamstrings'], secondary: ['traps', 'forearms'] },
  'good morning':      { primary: ['hamstrings', 'lower back'], secondary: ['glutes'] },
  'overhead press':    { primary: ['front delts', 'side delts'], secondary: ['triceps', 'core'] },
  'arnold press':      { primary: ['front delts', 'side delts'], secondary: ['triceps'] },
  'push press':        { primary: ['front delts'], secondary: ['triceps', 'quads'] },
  'landmine press':    { primary: ['front delts', 'chest'], secondary: ['triceps', 'core'] },
  'barbell row':       { primary: ['lats', 'upper back'], secondary: ['biceps', 'rear delts'] },
  'dumbbell row':      { primary: ['lats'],        secondary: ['biceps', 'rear delts'] },
  'cable row':         { primary: ['lats', 'upper back'], secondary: ['biceps'] },
  't-bar row':         { primary: ['lats', 'upper back'], secondary: ['biceps', 'rear delts'] },
  'pull up':           { primary: ['lats'],        secondary: ['biceps', 'core'] },
  'chin up':           { primary: ['lats', 'biceps'], secondary: ['core'] },
  'lat pulldown':      { primary: ['lats'],        secondary: ['biceps'] },
  'hip thrust':        { primary: ['glutes'],      secondary: ['hamstrings'] },
  'lunge':             { primary: ['quads', 'glutes'], secondary: ['hamstrings', 'core'] },
  'bulgarian split squat': { primary: ['quads', 'glutes'], secondary: ['hamstrings', 'core'] },
  'dip':               { primary: ['chest', 'triceps'], secondary: ['front delts'] },
  'face pull':         { primary: ['rear delts', 'upper back'], secondary: ['biceps'] },
  'lateral raise':     { primary: ['side delts'],  secondary: [] },
  'bicep curl':        { primary: ['biceps'],      secondary: ['forearms'] },
  'tricep extension':  { primary: ['triceps'],     secondary: [] },
  'calf raise':        { primary: ['calves'],      secondary: [] },
  'plank':             { primary: ['core'],        secondary: ['shoulders'] },
};

/**
 * Calculate fatigue index based on recent training data.
 * Formula: (total volume in period * avg intensity%) / recovery factor
 * Higher = more fatigued.
 */
export function calculateFatigueIndex(
  recentSets: { reps: number; weight_kg: number; estimated1RM?: number }[],
  days: number = 7
): number {
  if (recentSets.length === 0) return 0;

  const totalVolume = recentSets.reduce((sum, s) => sum + s.reps * s.weight_kg, 0);

  // Average intensity as % of estimated 1RM (if available), otherwise use weight directly
  const intensities = recentSets.map(s => {
    if (s.estimated1RM && s.estimated1RM > 0) {
      return s.weight_kg / s.estimated1RM;
    }
    return 0.75; // default assumed intensity if no 1RM data
  });
  const avgIntensity = intensities.reduce((sum, v) => sum + v, 0) / intensities.length;

  // Recovery factor: more days = more recovery opportunity
  const recoveryFactor = Math.max(1, days * 0.7);

  return Math.round((totalVolume * avgIntensity) / recoveryFactor);
}

/**
 * Determine if user is overreaching based on fatigue, sleep, and mood.
 * Returns warning status and recommendation.
 */
export function isOverreaching(
  fatigueIndex: number,
  sleepAvg: number,
  moodAvg: number
): { warning: boolean; level: 'ok' | 'caution' | 'overreaching'; message: string } {
  const FATIGUE_THRESHOLD = 5000; // Adjust based on population norms

  const highFatigue = fatigueIndex > FATIGUE_THRESHOLD;
  const poorSleep = sleepAvg < 6;
  const lowMood = moodAvg < 3;

  if (highFatigue && (poorSleep || lowMood)) {
    return {
      warning: true,
      level: 'overreaching',
      message: `Asiri yorgunluk sinyali! Yorgunluk indeksi: ${fatigueIndex}, uyku ort: ${sleepAvg}sa, mood: ${moodAvg}/5. Deload veya dinlenme gunu oneriyorum.`,
    };
  }

  if (highFatigue) {
    return {
      warning: true,
      level: 'caution',
      message: `Yorgunluk indeksi yuksek (${fatigueIndex}) ama uyku/mood normal. Dikkatli devam et, gerekliyse yogunlugu dusur.`,
    };
  }

  if (poorSleep && lowMood) {
    return {
      warning: true,
      level: 'caution',
      message: `Uyku (${sleepAvg}sa) ve mood (${moodAvg}/5) dusuk. Antrenman yogunlugunu azaltmayi dusun.`,
    };
  }

  return { warning: false, level: 'ok', message: '' };
}

// ─── Goal-Based Workout Routing (Phase 7) ───

/**
 * Get recommended workout type based on user's active goal.
 */
export function getGoalBasedWorkoutType(
  goalType: string
): { recommendedType: string; focus: string; note: string } {
  switch (goalType) {
    case 'lose_weight':
      return {
        recommendedType: 'mixed',
        focus: 'Kardiyo agirlikli + guc koruma',
        note: 'Yag yakim: 3x kardiyo + 2x guc. Kas kaybini onlemek icin guc antrenmanini birakma.',
      };
    case 'gain_muscle':
      return {
        recommendedType: 'strength',
        focus: 'Guc agirlikli + minimal kardiyo',
        note: 'Kas gelistirme: 4x guc + 1x hafif kardiyo. Progresif yuklenmeye odaklan.',
      };
    case 'gain_weight':
      return {
        recommendedType: 'strength',
        focus: 'Bilesik hareketler + az kardiyo',
        note: 'Kilo alma: agir bilesik hareketler (squat, deadlift, bench). Kardiyo minimumda.',
      };
    case 'health':
      return {
        recommendedType: 'mixed',
        focus: 'Dengeli — guc + kardiyo + esneklik',
        note: 'Genel saglik: 2x guc + 2x kardiyo + 1x yoga/mobilite.',
      };
    case 'conditioning':
      return {
        recommendedType: 'cardio',
        focus: 'Kardiyo + HIIT',
        note: 'Kondisyon: 3x orta kardiyo + 2x HIIT.',
      };
    default:
      return {
        recommendedType: 'mixed',
        focus: 'Dengeli antrenman',
        note: '3x guc + 2x kardiyo.',
      };
  }
}

/**
 * Get workout-nutrition timing recommendations.
 */
export function getWorkoutNutritionTiming(
  workoutType: string
): { preWorkout: string; postWorkout: string } {
  const isStrength = workoutType === 'strength' || workoutType === 'mixed';

  return {
    preWorkout: isStrength
      ? '1-2 saat once: 30-50g karb + 15-20g protein (muz + yulaf, ekmek + peynir)'
      : '1 saat once: hafif karb (muz, hurma). Tok karna yapma.',
    postWorkout: isStrength
      ? '30dk-1 saat icinde: 30-40g protein + 40-60g karb (tavuk + pirinc, shake + muz)'
      : '20-30g protein + bol su.',
  };
}
