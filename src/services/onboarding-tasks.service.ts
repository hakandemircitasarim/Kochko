/**
 * Onboarding Tasks Service
 * 13 tasks that guide users to build a complete profile through conversation.
 * Ordered by priority: critical → important → nice-to-have.
 * Progressive disclosure: shows max 3 incomplete at a time.
 */
import { supabase } from '@/lib/supabase';

export interface OnboardingTask {
  key: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  prefillMessage: string;
  taskModeHint: string;
}

interface TaskCheckData {
  profile: Record<string, unknown> | null;
  healthEvents: { event_type: string }[];
  labValuesCount: number;
  allergiesCount: number;
  activeGoalsCount: number;
  completedTasks: string[];
}

type TaskDef = OnboardingTask & { checkCompletion: (d: TaskCheckData) => boolean };

const ONBOARDING_TASKS: TaskDef[] = [
  // === ZORUNLU (ilk 2 her zaman gösterilir) ===
  {
    key: 'introduce_yourself',
    title: 'Kendini tanıt',
    description: 'Boy, kilo, yaş ve cinsiyet bilgilerini paylaş',
    icon: 'person-outline',
    color: '#1D9E75',
    prefillMessage: 'Merhaba! Kendimi tanıtmak istiyorum.',
    taskModeHint: 'onboarding_intro',
    checkCompletion: (d) =>
      !!(d.profile?.height_cm && d.profile?.weight_kg && d.profile?.birth_year && d.profile?.gender)
      || d.completedTasks.includes('introduce_yourself'),
  },
  {
    key: 'set_goal',
    title: 'Hedefini belirle',
    description: 'Ne istiyorsun ve neden? Hedef kilon ne?',
    icon: 'flag-outline',
    color: '#1D9E75',
    prefillMessage: 'Hedeflerimi konuşmak istiyorum.',
    taskModeHint: 'onboarding_goal',
    checkCompletion: (d) =>
      d.activeGoalsCount > 0
      || d.completedTasks.includes('set_goal'),
      // Aktif goals satırı da tamam sayılır: serbest onboarding mesajıyla hedef
      // koyan kullanıcıya kart "Hedefini belirle" demeye devam ediyordu.
  },

  // === ÖNEMLİ (sırayla gösterilir) ===
  {
    key: 'daily_routine',
    title: 'Günlük rutinini anlat',
    description: 'Mesleğin, çalışma saatlerin, ne kadar aktifsin',
    icon: 'time-outline',
    color: '#378ADD',
    prefillMessage: 'Günlük rutinimi ve iş hayatımı anlatmak istiyorum.',
    taskModeHint: 'onboarding_routine',
    checkCompletion: (d) =>
      !!(d.profile?.occupation || d.profile?.work_start)
      || d.completedTasks.includes('daily_routine'),
  },
  {
    key: 'eating_habits',
    title: 'Beslenme alışkanlıklarını anlat',
    description: 'Öğün sayısı, saatleri, dışarıda yeme, atıştırma',
    icon: 'restaurant-outline',
    color: '#1D9E75',
    prefillMessage: 'Beslenme alışkanlıklarım ve günlük yeme düzenim hakkında konuşalım.',
    taskModeHint: 'onboarding_eating',
    checkCompletion: (d) =>
      !!d.profile?.eating_out_frequency
      || d.completedTasks.includes('eating_habits'),
      // meal_count_preference KULLANILMAZ: kolonun DB default'u 3 olduğundan
      // her kullanıcı doğuştan "tamamlanmış" sayılıyordu ve bu kart hiçbir
      // kullanıcıda asla görünmüyordu.
  },
  {
    key: 'allergies',
    title: 'Alerji ve hassasiyetlerini bildir',
    description: 'Yiyecek alerjileri, intoleranslar, sindirim sorunları',
    icon: 'warning-outline',
    color: '#EF9F27',
    prefillMessage: 'Yiyecek alerjilerim, intoleranslarım ve sindirim sorunlarım hakkında konuşalım.',
    taskModeHint: 'onboarding_allergies',
    checkCompletion: (d) =>
      d.allergiesCount > 0
      || d.completedTasks.includes('allergies'),
  },
  {
    key: 'kitchen_logistics',
    title: 'Mutfak imkânlarını anlat',
    description: 'Pişirme becerisi, bütçe, ekipman, hazırlama süresi',
    icon: 'flame-outline',
    color: '#D85A30',
    prefillMessage: 'Mutfak imkânlarım, pişirme becerim ve bütçem hakkında konuşalım.',
    taskModeHint: 'onboarding_kitchen',
    checkCompletion: (d) =>
      !!(d.profile?.kitchen_equipment || d.profile?.meal_prep_time)
      || d.completedTasks.includes('kitchen_logistics'),
  },
  {
    key: 'exercise_history',
    title: 'Spor geçmişini anlat',
    description: 'Deneyimin, tercihlerin, sevmediklerin, antrenman saatlerin',
    icon: 'barbell-outline',
    color: '#7F77DD',
    prefillMessage: 'Spor geçmişim, deneyimim ve tercihlerim hakkında konuşmak istiyorum.',
    taskModeHint: 'onboarding_exercise',
    checkCompletion: (d) =>
      !!(d.profile?.exercise_history || d.profile?.training_experience)
      || d.completedTasks.includes('exercise_history'),
  },
  {
    key: 'health_history',
    title: 'Sağlık geçmişini anlat',
    description: 'Ameliyat, hastalık, ilaçlar, hormon durumu',
    icon: 'medical-outline',
    color: '#D4537E',
    prefillMessage: 'Sağlık geçmişim, ameliyatlarım, kullandığım ilaçlar ve hormon durumum hakkında konuşalım.',
    taskModeHint: 'onboarding_health',
    checkCompletion: (d) =>
      d.healthEvents.length > 0
      || d.completedTasks.includes('health_history'),
  },
  {
    key: 'weight_history',
    title: 'Kilo geçmişini anlat',
    description: 'Daha önce denediğin diyetler ve sonuçları',
    icon: 'trending-down-outline',
    color: '#7F77DD',
    prefillMessage: 'Kilo verme geçmişim ve daha önce denediğim diyetler hakkında konuşmak istiyorum.',
    taskModeHint: 'onboarding_weight_history',
    checkCompletion: (d) =>
      !!(d.profile?.previous_diets)
      || d.completedTasks.includes('weight_history'),
  },

  // === İYİ OLUR ===
  {
    key: 'lab_values',
    title: 'Kan tahlillerini paylaş',
    description: 'Varsa son kan tahlil sonuçlarını paylaş',
    icon: 'flask-outline',
    color: '#378ADD',
    prefillMessage: 'Kan tahlil sonuçlarımı paylaşmak istiyorum.',
    taskModeHint: 'onboarding_labs',
    checkCompletion: (d) =>
      d.labValuesCount > 0
      || d.completedTasks.includes('lab_values'),
  },
  {
    key: 'sleep_patterns',
    title: 'Uyku düzenini anlat',
    description: 'Uyku saatlerin, kaliten, sorunların',
    icon: 'moon-outline',
    color: '#7F77DD',
    prefillMessage: 'Uyku düzenim ve kalitem hakkında konuşmak istiyorum.',
    taskModeHint: 'onboarding_sleep',
    checkCompletion: (d) =>
      !!(d.profile?.sleep_time && d.profile?.sleep_quality)
      || d.completedTasks.includes('sleep_patterns'),
  },
  {
    key: 'stress_motivation',
    title: 'Stres ve motivasyonunu anlat',
    description: 'Stres kaynakların, motivasyonun, en büyük zorluğun',
    icon: 'heart-outline',
    color: '#D4537E',
    prefillMessage: 'Stres kaynaklarım, motivasyonum ve en büyük zorluğum hakkında konuşalım.',
    taskModeHint: 'onboarding_stress',
    checkCompletion: (d) =>
      !!(d.profile?.stress_level || d.profile?.motivation_source)
      || d.completedTasks.includes('stress_motivation'),
  },
  {
    key: 'home_environment',
    title: 'Ev ve çevre faktörlerini anlat',
    description: 'Evde kim yemek yapıyor, diyet yapmayan var mı',
    icon: 'home-outline',
    color: '#378ADD',
    prefillMessage: 'Ev ortamım ve yemek yapma durumum hakkında konuşalım.',
    taskModeHint: 'onboarding_home',
    checkCompletion: (d) =>
      !!(d.profile?.household_cooking)
      || d.completedTasks.includes('home_environment'),
  },
];

// FIX (kullanıcı bulgusu): getIncompleteTasks / getOnboardingProgress / getTasksWithStatus
// üçü de AYNI 6 sorguluk kontrol verisini okuyor — kopya Promise.all blokları yerine tek
// ortak yükleyici. `failed` bayrağı sorgu hatalarını yüzeye taşır: "Konular" genel bakış
// modalı bir ağ hatasını "hiçbir konu tamamlanmadı" gibi GÖSTERMEMELİ (mevcut iki fonksiyon
// bayrağı yok sayarak eski davranışlarını birebir korur).
async function loadTaskCheckData(userId: string): Promise<{ checkData: TaskCheckData; failed: boolean }> {
  const [profileRes, healthEventsRes, labValuesRes, allergiesRes, summaryRes, goalsRes] = await Promise.all([
    supabase.from('profiles').select('height_cm, weight_kg, birth_year, gender, occupation, work_start, meal_count_preference, eating_out_frequency, kitchen_equipment, meal_prep_time, exercise_history, training_experience, previous_diets, sleep_time, sleep_quality, stress_level, motivation_source, household_cooking').eq('id', userId).maybeSingle(),
    supabase.from('health_events').select('event_type').eq('user_id', userId),
    supabase.from('lab_values').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('food_preferences').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('is_allergen', true),
    supabase.from('ai_summary').select('onboarding_tasks_completed').eq('user_id', userId).maybeSingle(),
    supabase.from('goals').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('is_active', true),
  ]);
  const failed = !!(profileRes.error || healthEventsRes.error || labValuesRes.error
    || allergiesRes.error || summaryRes.error || goalsRes.error);
  const checkData: TaskCheckData = {
    profile: profileRes.data as Record<string, unknown> | null,
    healthEvents: (healthEventsRes.data ?? []) as { event_type: string }[],
    labValuesCount: labValuesRes.count ?? 0,
    allergiesCount: allergiesRes.count ?? 0,
    activeGoalsCount: goalsRes.count ?? 0,
    completedTasks: ((summaryRes.data as Record<string, unknown>)?.onboarding_tasks_completed as string[]) ?? [],
  };
  return { checkData, failed };
}

/**
 * Get incomplete onboarding tasks for the user.
 * First 2 (introduce + goal) always shown if incomplete.
 * Then up to maxCount-2 from the remaining, in order.
 */
export async function getIncompleteTasks(userId: string, maxCount = 3): Promise<OnboardingTask[]> {
  try {
    const { checkData } = await loadTaskCheckData(userId);
    const incomplete = ONBOARDING_TASKS.filter(t => !t.checkCompletion(checkData));

    // Always show first 2 if incomplete, then fill remaining slots
    const critical = incomplete.filter(t => t.key === 'introduce_yourself' || t.key === 'set_goal');
    const rest = incomplete.filter(t => t.key !== 'introduce_yourself' && t.key !== 'set_goal');
    const result = [...critical, ...rest].slice(0, maxCount);

    return result.map(({ checkCompletion, ...task }) => task);
  } catch {
    return [];
  }
}

/**
 * Overall onboarding progress across all 13 profile-building tasks.
 * Powers the "X / 13 tamamlandı" header + progress bar so the user can see how
 * far along they are instead of facing an open-ended list (note: "sonsuz kuyu").
 */
export async function getOnboardingProgress(userId: string): Promise<{ completed: number; total: number }> {
  try {
    const { checkData } = await loadTaskCheckData(userId);
    const completed = ONBOARDING_TASKS.filter(t => t.checkCompletion(checkData)).length;
    return { completed, total: ONBOARDING_TASKS.length };
  } catch {
    return { completed: 0, total: ONBOARDING_TASKS.length };
  }
}

/**
 * FIX (kullanıcı bulgusu: "toplam kartları görmeliyiz — hangileri bitti hangileri bitmedi"):
 * TÜM konuları tanım sırasıyla, bitti/bitmedi durumlarıyla döner — chat başlığındaki
 * "Konular" genel bakış modalını besler. getIncompleteTasks'in tamamlanma mantığının
 * birebir aynısı (aynı checkCompletion + ai_summary.onboarding_tasks_completed seti).
 * getIncompleteTasks'in aksine okuma HATASINDA THROW eder: modal dürüst bir "tekrar
 * dene" gösterebilsin, hatayı "hiçbiri tamamlanmadı" gibi sunmasın.
 */
export async function getTasksWithStatus(userId: string): Promise<{ task: OnboardingTask; completed: boolean }[]> {
  const { checkData, failed } = await loadTaskCheckData(userId);
  if (failed) throw new Error('onboarding task status load failed');
  return ONBOARDING_TASKS.map((def) => {
    const { checkCompletion, ...task } = def;
    return { task, completed: checkCompletion(checkData) };
  });
}

/**
 * Lookup a single task's display metadata by key. Used by TaskCompletionCard
 * to render next-suggestion cards after the AI finishes a task.
 * Returns null for unknown keys (silently drops invalid next_suggestions).
 */
export function getTaskByKey(key: string): OnboardingTask | null {
  const def = ONBOARDING_TASKS.find(t => t.key === key);
  if (!def) return null;
  const { checkCompletion, ...rest } = def;
  return rest;
}

/**
 * Reverse lookup by taskModeHint — the chat thread renders a visible topic marker
 * when a task opener fires (the opener prompt itself is an invisible [SYSTEM_INIT],
 * so without the marker the coach appears to change subject out of nowhere).
 */
export function getTaskByModeHint(hint: string): OnboardingTask | null {
  const def = ONBOARDING_TASKS.find(t => t.taskModeHint === hint);
  if (!def) return null;
  const { checkCompletion, ...rest } = def;
  return rest;
}
