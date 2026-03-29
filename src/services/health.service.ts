/**
 * Health Events & Lab Values Service — Spec 2.1, 3.1
 * Full CRUD for health history and lab values.
 * AI uses these for workout restrictions and nutrition adjustments.
 */
import { supabase } from '@/lib/supabase';

// ===== Health Events =====

export interface HealthEvent {
  id: string;
  event_type: string;       // surgery, injury, illness, medication, allergy, other
  description: string;       // Structured: "Title | Bolge: X | Egzersizi etkiler | Details"
  event_date: string | null;
  is_ongoing: boolean;
  affected_body_part?: string | null;
  exercise_restriction?: boolean;
}

export async function getHealthEvents(): Promise<HealthEvent[]> {
  const { data } = await supabase
    .from('health_events')
    .select('*')
    .order('is_ongoing', { ascending: false }) // Ongoing first
    .order('event_date', { ascending: false });
  return (data ?? []) as HealthEvent[];
}

export async function getHealthEventsByType(eventType: string): Promise<HealthEvent[]> {
  const { data } = await supabase
    .from('health_events')
    .select('*')
    .eq('event_type', eventType)
    .order('event_date', { ascending: false });
  return (data ?? []) as HealthEvent[];
}

export async function getOngoingHealthEvents(): Promise<HealthEvent[]> {
  const { data } = await supabase
    .from('health_events')
    .select('*')
    .eq('is_ongoing', true)
    .order('event_date', { ascending: false });
  return (data ?? []) as HealthEvent[];
}

export async function addHealthEvent(event: Omit<HealthEvent, 'id'>): Promise<{ id: string | null; error: string | null }> {
  if (!event.description.trim()) return { id: null, error: 'Aciklama gerekli.' };

  const { data, error } = await supabase.from('health_events').insert(event).select('id').single();
  return { id: data?.id ?? null, error: error?.message ?? null };
}

export async function updateHealthEvent(id: string, updates: Partial<HealthEvent>): Promise<{ error: string | null }> {
  const { error } = await supabase.from('health_events').update(updates).eq('id', id);
  return { error: error?.message ?? null };
}

export async function deleteHealthEvent(id: string): Promise<void> {
  await supabase.from('health_events').delete().eq('id', id);
}

/**
 * Check if user has exercise restrictions (for AI workout planning).
 * Returns list of restricted body parts.
 */
export async function getExerciseRestrictions(): Promise<string[]> {
  const events = await getOngoingHealthEvents();
  return events
    .filter(e => e.description.includes('Egzersizi etkiler') || e.exercise_restriction)
    .map(e => {
      const bodyMatch = e.description.match(/Bolge: ([^|]+)/);
      return bodyMatch ? bodyMatch[1].trim() : e.event_type;
    });
}

// ===== Lab Values =====

export interface LabValue {
  id: string;
  parameter_name: string;
  value: number;
  unit: string;
  reference_min: number | null;
  reference_max: number | null;
  measured_at: string;
  is_out_of_range: boolean;
  notes?: string | null;
}

export async function getLabValues(): Promise<LabValue[]> {
  const { data } = await supabase
    .from('lab_values')
    .select('*')
    .order('measured_at', { ascending: false });
  return (data ?? []) as LabValue[];
}

export async function getLatestLabValues(): Promise<Map<string, LabValue>> {
  const all = await getLabValues();
  const latest = new Map<string, LabValue>();
  for (const lab of all) {
    if (!latest.has(lab.parameter_name)) {
      latest.set(lab.parameter_name, lab);
    }
  }
  return latest;
}

export async function getOutOfRangeLabValues(): Promise<LabValue[]> {
  const { data } = await supabase
    .from('lab_values')
    .select('*')
    .eq('is_out_of_range', true)
    .order('measured_at', { ascending: false });
  return (data ?? []) as LabValue[];
}

export async function addLabValue(entry: Omit<LabValue, 'id' | 'is_out_of_range'>): Promise<{ error: string | null }> {
  // Auto-determine if out of range
  const isOutOfRange = (entry.reference_min != null && entry.value < entry.reference_min)
    || (entry.reference_max != null && entry.value > entry.reference_max);

  const { error } = await supabase.from('lab_values').insert({ ...entry, is_out_of_range: isOutOfRange });
  return { error: error?.message ?? null };
}

export async function deleteLabValue(id: string): Promise<void> {
  await supabase.from('lab_values').delete().eq('id', id);
}

/**
 * Get lab value trend for a specific parameter.
 */
export async function getLabTrend(parameterName: string, limit = 10): Promise<{ value: number; date: string }[]> {
  const { data } = await supabase
    .from('lab_values')
    .select('value, measured_at')
    .eq('parameter_name', parameterName)
    .order('measured_at', { ascending: true })
    .limit(limit);

  return (data ?? []).map(d => ({ value: d.value as number, date: d.measured_at as string }));
}

// Common Turkish lab parameters with reference ranges
export const COMMON_LAB_PARAMS = [
  { name: 'Aclik Kan Sekeri', unit: 'mg/dL', refMin: 70, refMax: 100 },
  { name: 'HbA1c', unit: '%', refMin: 4.0, refMax: 5.6 },
  { name: 'Total Kolesterol', unit: 'mg/dL', refMin: 0, refMax: 200 },
  { name: 'LDL', unit: 'mg/dL', refMin: 0, refMax: 130 },
  { name: 'HDL', unit: 'mg/dL', refMin: 40, refMax: 999 },
  { name: 'Trigliserit', unit: 'mg/dL', refMin: 0, refMax: 150 },
  { name: 'TSH', unit: 'mIU/L', refMin: 0.4, refMax: 4.0 },
  { name: 'Vitamin D', unit: 'ng/mL', refMin: 30, refMax: 100 },
  { name: 'Vitamin B12', unit: 'pg/mL', refMin: 200, refMax: 900 },
  { name: 'Ferritin', unit: 'ng/mL', refMin: 12, refMax: 300 },
  { name: 'Demir', unit: 'ug/dL', refMin: 60, refMax: 170 },
  { name: 'Hemoglobin', unit: 'g/dL', refMin: 12, refMax: 17 },
  { name: 'Kreatinin', unit: 'mg/dL', refMin: 0.6, refMax: 1.2 },
  { name: 'ALT', unit: 'U/L', refMin: 0, refMax: 40 },
  { name: 'AST', unit: 'U/L', refMin: 0, refMax: 40 },
];
