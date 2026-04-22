/**
 * Health Events & Lab Values Service
 * Spec 2.1 (sağlık geçmişi) + 3.1 (lab kaydı)
 */
import { supabase } from '@/lib/supabase';

// Health events
export interface HealthEvent {
  id: string;
  event_type: string;
  description: string;
  event_date: string | null;
  is_ongoing: boolean;
}

export async function getHealthEvents(): Promise<HealthEvent[]> {
  try {
    const { data, error } = await supabase.from('health_events').select('*').order('event_date', { ascending: false });
    if (error) { console.error('getHealthEvents error:', error.message); return []; }
    return (data ?? []) as HealthEvent[];
  } catch (err) {
    console.error('getHealthEvents unexpected error:', err);
    return [];
  }
}

export async function addHealthEvent(event: Omit<HealthEvent, 'id'>): Promise<void> {
  const { error } = await supabase.from('health_events').insert(event);
  if (error) console.error('addHealthEvent error:', error.message);
}

// Lab values
export interface LabValue {
  id: string;
  parameter_name: string;
  value: number;
  unit: string;
  reference_min: number | null;
  reference_max: number | null;
  measured_at: string;
  is_out_of_range: boolean;
}

export async function getLabValues(): Promise<LabValue[]> {
  try {
    const { data, error } = await supabase.from('lab_values').select('*').order('measured_at', { ascending: false });
    if (error) { console.error('getLabValues error:', error.message); return []; }
    return (data ?? []) as LabValue[];
  } catch (err) {
    console.error('getLabValues unexpected error:', err);
    return [];
  }
}

export async function addLabValue(entry: Omit<LabValue, 'id' | 'is_out_of_range'>): Promise<void> {
  const { error } = await supabase.from('lab_values').insert(entry);
  if (error) console.error('addLabValue error:', error.message);
}

// Common Turkish lab parameters with reference ranges
export const COMMON_LAB_PARAMS = [
  { name: 'Açlık Kan Şekeri', unit: 'mg/dL', refMin: 70, refMax: 100 },
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
