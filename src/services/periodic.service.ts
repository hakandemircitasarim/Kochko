/**
 * Periodic State Management Service
 * Spec Section 9: Dönemsel durum yönetimi
 * Ramazan, tatil, hamilelik, hastalık, seyahat, etc.
 */
import { supabase } from '@/lib/supabase';

export type PeriodicState =
  | 'ramadan' | 'holiday' | 'illness' | 'busy_work' | 'exam'
  | 'pregnancy' | 'breastfeeding' | 'injury' | 'travel' | 'custom';

export const PERIODIC_LABELS: Record<PeriodicState, string> = {
  ramadan: 'Ramazan',
  holiday: 'Tatil',
  illness: 'Hastalik',
  busy_work: 'Yogun is donemi',
  exam: 'Sinav donemi',
  pregnancy: 'Hamilelik',
  breastfeeding: 'Emzirme',
  injury: 'Sakatlanma',
  travel: 'Seyahat',
  custom: 'Ozel donem',
};

export async function setPeriodicState(
  userId: string,
  state: PeriodicState | null,
  startDate?: string,
  endDate?: string
): Promise<void> {
  await supabase.from('profiles').update({
    periodic_state: state,
    periodic_state_start: startDate ?? new Date().toISOString().split('T')[0],
    periodic_state_end: endDate ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', userId);
}

export async function clearPeriodicState(userId: string): Promise<void> {
  await supabase.from('profiles').update({
    periodic_state: null,
    periodic_state_start: null,
    periodic_state_end: null,
    updated_at: new Date().toISOString(),
  }).eq('id', userId);
}
