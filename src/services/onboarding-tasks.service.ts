/**
 * Onboarding Tasks Service
 * Defines tasks that help build a complete user profile through conversation.
 * Tasks appear as cards on the Kochko session list screen.
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
  healthEvents: { event_type: string }[];
  labValuesCount: number;
  allergiesCount: number;
  completedTasks: string[];
}

const ONBOARDING_TASKS: (OnboardingTask & { checkCompletion: (d: TaskCheckData) => boolean })[] = [
  {
    key: 'surgery_history',
    title: 'Ameliyat geçmişini anlat',
    description: 'Koçun ameliyat geçmişini bilmeli',
    icon: 'medical-outline',
    color: '#D4537E',
    prefillMessage: 'Ameliyat geçmişim hakkında konuşmak istiyorum',
    taskModeHint: 'onboarding_surgery',
    checkCompletion: (d) => d.healthEvents.some(e => e.event_type === 'surgery')
      || d.completedTasks.includes('surgery_history'),
  },
  {
    key: 'lab_values',
    title: 'Kan tahlillerini paylaş',
    description: 'Varsa son kan tahlil sonuçlarını gönder',
    icon: 'flask-outline',
    color: '#378ADD',
    prefillMessage: 'Kan tahlil sonuçlarımı paylaşmak istiyorum',
    taskModeHint: 'onboarding_labs',
    checkCompletion: (d) => d.labValuesCount > 0
      || d.completedTasks.includes('lab_values'),
  },
  {
    key: 'allergies',
    title: 'Alerji ve intoleranslarını bildir',
    description: 'Yiyecek alerjilerin ve hassasiyetlerin',
    icon: 'warning-outline',
    color: '#EF9F27',
    prefillMessage: 'Yiyecek alerjilerim ve intoleranslarım hakkında konuşalım',
    taskModeHint: 'onboarding_allergies',
    checkCompletion: (d) => d.allergiesCount > 0
      || d.completedTasks.includes('allergies'),
  },
  {
    key: 'weight_history',
    title: 'Kilo geçmişini anlat',
    description: 'Daha önce diyet denedin mi? Ne oldu?',
    icon: 'trending-down-outline',
    color: '#7F77DD',
    prefillMessage: 'Kilo verme geçmişim ve daha önce denediğim diyetler hakkında konuşmak istiyorum',
    taskModeHint: 'onboarding_weight_history',
    checkCompletion: (d) => d.completedTasks.includes('weight_history'),
  },
  {
    key: 'medications',
    title: 'Kullandığın ilaçları bildir',
    description: 'Düzenli kullandığın ilaç veya takviye',
    icon: 'medkit-outline',
    color: '#D85A30',
    prefillMessage: 'Düzenli kullandığım ilaçlar ve takviyeler hakkında konuşalım',
    taskModeHint: 'onboarding_medications',
    checkCompletion: (d) => d.healthEvents.some(e => e.event_type === 'medication')
      || d.completedTasks.includes('medications'),
  },
  {
    key: 'exercise_history',
    title: 'Spor geçmişini anlat',
    description: 'Hangi sporları yaptın, seviyeni anlat',
    icon: 'barbell-outline',
    color: '#7F77DD',
    prefillMessage: 'Spor geçmişim ve deneyimim hakkında konuşmak istiyorum',
    taskModeHint: 'onboarding_exercise',
    checkCompletion: (d) => d.completedTasks.includes('exercise_history'),
  },
  {
    key: 'eating_habits',
    title: 'Beslenme alışkanlıklarını anlat',
    description: 'Günlük rutinin, sevdiğin yemekler',
    icon: 'restaurant-outline',
    color: '#1D9E75',
    prefillMessage: 'Beslenme alışkanlıklarım ve günlük rutinim hakkında konuşalım',
    taskModeHint: 'onboarding_eating',
    checkCompletion: (d) => d.completedTasks.includes('eating_habits'),
  },
  {
    key: 'sleep_patterns',
    title: 'Uyku düzenini anlat',
    description: 'Uyku saatlerin ve kaliteni paylaş',
    icon: 'moon-outline',
    color: '#7F77DD',
    prefillMessage: 'Uyku düzenim ve kalitem hakkında konuşmak istiyorum',
    taskModeHint: 'onboarding_sleep',
    checkCompletion: (d) => d.completedTasks.includes('sleep_patterns'),
  },
];

/**
 * Get up to `maxCount` incomplete onboarding tasks for the user.
 */
export async function getIncompleteTasks(userId: string, maxCount = 3): Promise<OnboardingTask[]> {
  try {
    const [healthEventsRes, labValuesRes, allergiesRes, summaryRes] = await Promise.all([
      supabase.from('health_events').select('event_type').eq('user_id', userId),
      supabase.from('lab_values').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('food_preferences').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('is_allergen', true),
      supabase.from('ai_summary').select('onboarding_tasks_completed').eq('user_id', userId).maybeSingle(),
    ]);

    const checkData: TaskCheckData = {
      healthEvents: (healthEventsRes.data ?? []) as { event_type: string }[],
      labValuesCount: labValuesRes.count ?? 0,
      allergiesCount: allergiesRes.count ?? 0,
      completedTasks: ((summaryRes.data as Record<string, unknown>)?.onboarding_tasks_completed as string[]) ?? [],
    };

    const incomplete = ONBOARDING_TASKS.filter(t => !t.checkCompletion(checkData));
    return incomplete.slice(0, maxCount).map(({ checkCompletion, ...task }) => task);
  } catch {
    return [];
  }
}
