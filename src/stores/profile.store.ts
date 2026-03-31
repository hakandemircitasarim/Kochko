import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { Profile } from '@/types/database';
import { calculateProfileCompletion, CompletionResult } from '@/lib/profile-completion';

interface ProfileState {
  profile: Profile | null;
  loading: boolean;
  fetch: (userId: string) => Promise<void>;
  update: (userId: string, data: Partial<Profile>) => Promise<void>;
  reactivateAccount: (userId: string) => Promise<void>;
  getCompletion: () => CompletionResult | null;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profile: null,
  loading: false,

  fetch: async (userId) => {
    set({ loading: true });
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
    set({ profile: data as Profile | null, loading: false });
  },

  update: async (userId, updates) => {
    await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', userId);

    const merged = { ...get().profile, ...updates } as Profile;

    // Recalculate profile completion percentage
    const { percentage } = calculateProfileCompletion(merged as unknown as Record<string, unknown>);
    if (percentage !== merged.profile_completion_pct) {
      await supabase
        .from('profiles')
        .update({ profile_completion_pct: percentage })
        .eq('id', userId);
      merged.profile_completion_pct = percentage;
    }

    set({ profile: merged });
  },

  reactivateAccount: async (userId) => {
    await supabase
      .from('profiles')
      .update({ deleted_at: null, updated_at: new Date().toISOString() } as Record<string, unknown>)
      .eq('id', userId);
    set(state => ({
      profile: state.profile
        ? ({ ...state.profile, deleted_at: null } as unknown as Profile)
        : null,
    }));
  },

  getCompletion: () => {
    const { profile } = get();
    if (!profile) return null;
    return calculateProfileCompletion(profile as unknown as Record<string, unknown>);
  },
}));
