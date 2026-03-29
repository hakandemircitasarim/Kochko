/**
 * Periodic State Service — Spec 9.1-9.4
 * Manages temporary life situations: Ramadan, holiday, illness, pregnancy, etc.
 * AI adjusts plans automatically based on active periodic state.
 */
import { supabase } from '@/lib/supabase';

export type PeriodicStateType =
  | 'ramadan' | 'holiday' | 'illness' | 'busy_work' | 'exam'
  | 'pregnancy' | 'breastfeeding' | 'injury' | 'travel' | 'custom';

export const PERIODIC_LABELS: Record<PeriodicStateType, string> = {
  ramadan: 'Ramazan / Oruc',
  holiday: 'Tatil',
  illness: 'Hastalik',
  busy_work: 'Yogun Is Donemi',
  exam: 'Sinav Donemi',
  pregnancy: 'Hamilelik',
  breastfeeding: 'Emzirme',
  injury: 'Sakatlanma / Iyilesme',
  travel: 'Seyahat',
  custom: 'Ozel Donem',
};

export const PERIODIC_DESCRIPTIONS: Record<PeriodicStateType, string> = {
  ramadan: 'Iftar ve sahur saatlerine gore plan ayarlanir. Kalori acigi azaltilir.',
  holiday: 'Esnek mod aktif. Koc yargilamaz, hasar minimizasyonu yapar.',
  illness: 'Antrenman azaltilir/durdurulur. Beslenme iyilesmeye odaklanir.',
  busy_work: 'Daha basit plan, hizli ogunler. Minimum viable day modu kolay devreye girer.',
  exam: 'Dusuk stres stratejisi. Basit, tekrar eden ogunler onerilir.',
  pregnancy: 'Kalori acigi UYGULANMAZ. Trimestere gore TDEE ayarlanir. Doktor takibi hatirlatilir.',
  breastfeeding: 'TDEE +400-500 kcal. Agresif kilo kaybi engellenir.',
  injury: 'Etkilenen bolge icin egzersiz kisitlanir. Alternatif hareketler onerilir.',
  travel: 'Saat dilimi, yerel mutfak, esnek plan. IF penceresi kademeli gecis.',
  custom: 'Ozel donem — kocuna durumu anlat, plan buna gore ayarlansin.',
};

export async function setPeriodicState(
  userId: string,
  state: PeriodicStateType,
  startDate?: string,
  endDate?: string,
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
    periodic_state: null, periodic_state_start: null, periodic_state_end: null,
    updated_at: new Date().toISOString(),
  }).eq('id', userId);
}

export async function getPeriodicState(userId: string): Promise<{
  state: PeriodicStateType | null;
  startDate: string | null;
  endDate: string | null;
  label: string | null;
  description: string | null;
}> {
  const { data } = await supabase.from('profiles')
    .select('periodic_state, periodic_state_start, periodic_state_end')
    .eq('id', userId).single();

  if (!data?.periodic_state) return { state: null, startDate: null, endDate: null, label: null, description: null };

  const state = data.periodic_state as PeriodicStateType;
  return {
    state,
    startDate: data.periodic_state_start as string | null,
    endDate: data.periodic_state_end as string | null,
    label: PERIODIC_LABELS[state] ?? state,
    description: PERIODIC_DESCRIPTIONS[state] ?? null,
  };
}

export function isPeriodicStateExpired(endDate: string | null): boolean {
  if (!endDate) return false;
  return new Date() > new Date(endDate);
}

export function getPeriodicStateContext(state: PeriodicStateType, endDate: string | null): string {
  const base = `Kullanici su an ${PERIODIC_LABELS[state]} doneminde.`;
  const desc = PERIODIC_DESCRIPTIONS[state];
  const endStr = endDate ? ` Tahmini bitis: ${endDate}.` : '';
  return `${base} ${desc}${endStr}`;
}
