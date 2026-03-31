/**
 * Periodic State Management Service
 * Spec Section 9: Dönemsel durum yönetimi
 * Ramazan, tatil, hamilelik, hastalık, seyahat, etc.
 * NOTE: Server-side config mirror in supabase/functions/shared/periodic-config.ts — keep in sync.
 */
import { supabase } from '@/lib/supabase';

export type PeriodicState =
  | 'ramadan' | 'holiday' | 'illness' | 'busy_work' | 'exam'
  | 'pregnancy' | 'breastfeeding' | 'injury' | 'travel' | 'custom';

// ─── Config (client-side mirror of server periodic-config.ts) ───

export interface PeriodicStateConfig {
  calorieAdjustment: number;
  proteinMultiplier: number;
  workoutIntensityMax: 'low' | 'moderate' | 'high';
  ifCompatible: boolean;
  waterMultiplier: number;
  requiresEndDate: boolean;
  maxDurationDays: number | null;
  label_tr: string;
  description_tr: string;
}

export const PERIODIC_STATE_CONFIG: Record<PeriodicState, PeriodicStateConfig> = {
  ramadan: {
    calorieAdjustment: -150, proteinMultiplier: 1.0, workoutIntensityMax: 'moderate',
    ifCompatible: false, waterMultiplier: 1.3, requiresEndDate: true, maxDurationDays: 30,
    label_tr: 'Ramazan', description_tr: 'Ogunler iftar-sahur penceresine sigdirilir, antrenman yogunlugu dusurulur.',
  },
  holiday: {
    calorieAdjustment: 0, proteinMultiplier: 1.0, workoutIntensityMax: 'high',
    ifCompatible: true, waterMultiplier: 1.0, requiresEndDate: true, maxDurationDays: 30,
    label_tr: 'Tatil', description_tr: 'Esneklik modu: kalori araligi genisler, guilt-free yaklasim.',
  },
  illness: {
    calorieAdjustment: 0, proteinMultiplier: 1.0, workoutIntensityMax: 'low',
    ifCompatible: false, waterMultiplier: 1.2, requiresEndDate: false, maxDurationDays: 30,
    label_tr: 'Hastalik', description_tr: 'Kalori acigi kaldirilir, IF durdurulur, sadece hafif aktivite.',
  },
  busy_work: {
    calorieAdjustment: 0, proteinMultiplier: 1.0, workoutIntensityMax: 'moderate',
    ifCompatible: true, waterMultiplier: 1.0, requiresEndDate: true, maxDurationDays: 60,
    label_tr: 'Yogun Is Donemi', description_tr: 'Basit ve hizli ogunler onerilir, kisa antrenmanlar.',
  },
  exam: {
    calorieAdjustment: 0, proteinMultiplier: 1.0, workoutIntensityMax: 'moderate',
    ifCompatible: true, waterMultiplier: 1.0, requiresEndDate: true, maxDurationDays: 60,
    label_tr: 'Sinav Donemi', description_tr: 'Beyin besinleri on planda, stres yeme uyarisi aktif.',
  },
  pregnancy: {
    calorieAdjustment: 300, proteinMultiplier: 1.1, workoutIntensityMax: 'moderate',
    ifCompatible: false, waterMultiplier: 1.1, requiresEndDate: true, maxDurationDays: 280,
    label_tr: 'Hamilelik', description_tr: 'IF durdurulur, kalori artirilir, yasak besinler filtrelenir.',
  },
  breastfeeding: {
    calorieAdjustment: 500, proteinMultiplier: 1.2, workoutIntensityMax: 'moderate',
    ifCompatible: false, waterMultiplier: 1.3, requiresEndDate: false, maxDurationDays: null,
    label_tr: 'Emzirme', description_tr: 'Kalori +500, IF durdurulur, su hedefi artirilir.',
  },
  injury: {
    calorieAdjustment: -100, proteinMultiplier: 1.1, workoutIntensityMax: 'low',
    ifCompatible: true, waterMultiplier: 1.0, requiresEndDate: false, maxDurationDays: 90,
    label_tr: 'Sakatlik', description_tr: 'Etkilenen bolge antrenman disi, protein artirilir.',
  },
  travel: {
    calorieAdjustment: 0, proteinMultiplier: 1.0, workoutIntensityMax: 'high',
    ifCompatible: true, waterMultiplier: 1.1, requiresEndDate: true, maxDurationDays: 90,
    label_tr: 'Seyahat', description_tr: 'Esneklik modu, lokal yiyecek kesfetme, donus plani.',
  },
  custom: {
    calorieAdjustment: 0, proteinMultiplier: 1.0, workoutIntensityMax: 'high',
    ifCompatible: true, waterMultiplier: 1.0, requiresEndDate: false, maxDurationDays: null,
    label_tr: 'Ozel Durum', description_tr: 'Kullanici tanimli ozel donem.',
  },
};

export const PERIODIC_LABELS: Record<PeriodicState, string> = Object.fromEntries(
  Object.entries(PERIODIC_STATE_CONFIG).map(([k, v]) => [k, v.label_tr])
) as Record<PeriodicState, string>;

// ─── Validation ───

export function validatePeriodicState(
  state: PeriodicState,
  startDate: string | null,
  endDate: string | null,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const config = PERIODIC_STATE_CONFIG[state];

  if (config.requiresEndDate && !endDate) {
    errors.push(`${config.label_tr} icin bitis tarihi gerekli.`);
  }

  if (startDate && endDate) {
    if (new Date(endDate) < new Date(startDate)) {
      errors.push('Bitis tarihi baslangictan once olamaz.');
    }
    if (config.maxDurationDays) {
      const days = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));
      if (days > config.maxDurationDays) {
        errors.push(`Maksimum sure: ${config.maxDurationDays} gun.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── IF Conflict Detection ───

export function detectIFConflict(
  state: PeriodicState,
  ifActive: boolean,
): { conflict: boolean; action: 'pause_if' | 'warn' | 'none'; message_tr: string } {
  if (!ifActive) return { conflict: false, action: 'none', message_tr: '' };

  const config = PERIODIC_STATE_CONFIG[state];
  if (!config.ifCompatible) {
    return {
      conflict: true,
      action: 'pause_if',
      message_tr: `${config.label_tr} doneminde IF uygun degil. IF otomatik durdurulacak.`,
    };
  }

  return { conflict: false, action: 'none', message_tr: '' };
}

// ─── Transition Info ───

export function getTransitionInfo(
  state: PeriodicState,
  startDate: string | null,
  endDate: string | null,
): { daysRemaining: number | null; isExpiring: boolean; isExpired: boolean; transitionMessage_tr: string | null } {
  if (!endDate) {
    return { daysRemaining: null, isExpiring: false, isExpired: false, transitionMessage_tr: null };
  }

  const end = new Date(endDate);
  const today = new Date();
  const daysRemaining = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const config = PERIODIC_STATE_CONFIG[state];

  if (daysRemaining <= 0) {
    return {
      daysRemaining: 0,
      isExpiring: false,
      isExpired: true,
      transitionMessage_tr: `${config.label_tr} doneminiz sona erdi. Normal programa donus plani hazirlanacak.`,
    };
  }

  if (daysRemaining <= 3) {
    return {
      daysRemaining,
      isExpiring: true,
      isExpired: false,
      transitionMessage_tr: `${config.label_tr} doneminiz ${daysRemaining} gun icinde sona erecek. Gecis plani hazirlanacak.`,
    };
  }

  return { daysRemaining, isExpiring: false, isExpired: false, transitionMessage_tr: null };
}

// ─── Enhanced Set/Clear ───

export async function setPeriodicState(
  userId: string,
  state: PeriodicState | null,
  startDate?: string,
  endDate?: string,
  ifActive?: boolean,
): Promise<{ ifPaused: boolean }> {
  let ifPaused = false;

  if (state) {
    // Validate
    const { valid, errors } = validatePeriodicState(state, startDate ?? null, endDate ?? null);
    if (!valid) {
      throw new Error(errors.join(' '));
    }

    // Check IF conflict
    if (ifActive) {
      const conflict = detectIFConflict(state, true);
      if (conflict.action === 'pause_if') {
        ifPaused = true;
      }
    }
  }

  const updates: Record<string, unknown> = {
    periodic_state: state,
    periodic_state_start: state ? (startDate ?? new Date().toISOString().split('T')[0]) : null,
    periodic_state_end: state ? (endDate ?? null) : null,
    updated_at: new Date().toISOString(),
  };

  if (ifPaused) {
    updates.if_active = false;
  }

  await supabase.from('profiles').update(updates).eq('id', userId);

  // Auto-replan: trigger new daily plan generation when periodic state changes (Spec 9.2)
  if (state) {
    supabase.functions.invoke('ai-plan', {
      body: { type: 'daily', periodic_state_changed: true },
    }).catch(() => {}); // Non-blocking, best effort
  }

  return { ifPaused };
}

export async function clearPeriodicState(userId: string): Promise<{ previousState: string | null }> {
  // Get current state before clearing
  const { data } = await supabase.from('profiles').select('periodic_state').eq('id', userId).single();
  const previousState = (data as { periodic_state: string | null } | null)?.periodic_state ?? null;

  await supabase.from('profiles').update({
    periodic_state: null,
    periodic_state_start: null,
    periodic_state_end: null,
    updated_at: new Date().toISOString(),
  }).eq('id', userId);

  return { previousState };
}
