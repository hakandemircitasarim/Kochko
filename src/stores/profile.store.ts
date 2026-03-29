import { create } from 'zustand';
import { supabase } from '@/lib/supabase';

interface Profile {
  id: string;
  height_cm: number | null;
  weight_kg: number | null;
  birth_year: number | null;
  gender: string | null;
  activity_level: string | null;
  equipment_access: string | null;
  training_style: string | null;
  diet_mode: string | null;
  coach_tone: string | null;
  if_active: boolean;
  if_window: string | null;
  onboarding_completed: boolean;
  premium: boolean;
  premium_expires_at: string | null;
  profile_completion_pct: number;
  calorie_range_training_min: number | null;
  calorie_range_training_max: number | null;
  calorie_range_rest_min: number | null;
  calorie_range_rest_max: number | null;
  protein_per_kg: number | null;
  water_target_liters: number | null;
  periodic_state: string | null;
  [key: string]: unknown;
}

interface ProfileState {
  profile: Profile | null;
  loading: boolean;
  fetch: (userId: string) => Promise<void>;
  update: (userId: string, data: Partial<Profile>) => Promise<void>;
}

export const useProfileStore = create<ProfileState>((set) => ({
  profile: null,
  loading: false,

  fetch: async (userId) => {
    set({ loading: true });
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
    set({ profile: data as Profile | null, loading: false });
  },

  update: async (userId, updates) => {
    await supabase.from('profiles').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', userId);
    set(state => ({ profile: state.profile ? { ...state.profile, ...updates } : null }));
  },
}));
