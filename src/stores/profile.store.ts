import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types/database';

interface ProfileState {
  profile: Profile | null;
  loading: boolean;
  fetchProfile: (userId: string) => Promise<void>;
  updateProfile: (userId: string, updates: Partial<Profile>) => Promise<{ error: string | null }>;
}

export const useProfileStore = create<ProfileState>((set) => ({
  profile: null,
  loading: false,

  fetchProfile: async (userId) => {
    set({ loading: true });
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (!error && data) {
      set({ profile: data as Profile, loading: false });
    } else {
      set({ loading: false });
    }
  },

  updateProfile: async (userId, updates) => {
    const { error } = await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (!error) {
      set((state) => ({
        profile: state.profile ? { ...state.profile, ...updates } : null,
      }));
    }

    return { error: error?.message ?? null };
  },
}));
