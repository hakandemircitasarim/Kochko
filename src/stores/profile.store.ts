import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { Profile } from '@/types/database';
import { calculateProfileCompletion, CompletionResult } from '@/lib/profile-completion';
import { cancelAccountDeletion } from '@/services/privacy.service';

interface ProfileState {
  profile: Profile | null;
  loading: boolean;
  fetchError: boolean;
  fetch: (userId: string) => Promise<void>;
  update: (userId: string, data: Partial<Profile>) => Promise<void>;
  reactivateAccount: (userId: string) => Promise<void>;
  getCompletion: () => CompletionResult | null;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profile: null,
  loading: false,
  fetchError: false,

  fetch: async (userId) => {
    set({ loading: true, fetchError: false });
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) {
      // Transient/RLS error: keep any previously loaded profile rather than
      // wiping it to null (which would flip premium→free, blank the dashboard, etc.)
      // Expose fetchError so the router can offer a retry instead of spinning forever
      // when this is a cold start with no prior profile (#R7-2).
      if (__DEV__) console.warn('profile.fetch failed', error);
      set({ loading: false, fetchError: true });
      return;
    }
    // Only here is `data === null` a genuine "no row" signal.
    set({ profile: data as Profile | null, loading: false, fetchError: false });
  },

  update: async (userId, updates) => {
    const { error } = await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) throw error;

    const merged = { ...get().profile, ...updates } as Profile;

    // Recalculate profile completion percentage
    const { percentage } = calculateProfileCompletion(merged as unknown as Record<string, unknown>);
    if (percentage !== merged.profile_completion_pct) {
      const { error: pctErr } = await supabase
        .from('profiles')
        .update({ profile_completion_pct: percentage })
        .eq('id', userId);
      if (pctErr) throw pctErr;
      merged.profile_completion_pct = percentage;
    }

    set({ profile: merged });
  },

  reactivateAccount: async (userId) => {
    // Clear deletion_requested_at via the canonical cancel logic so a
    // reactivated account is not hard-deleted by the 30-day cron.
    await cancelAccountDeletion(userId);
    // Additionally clear deleted_at (cancelAccountDeletion only handles
    // deletion_requested_at).
    await supabase
      .from('profiles')
      .update({ deleted_at: null, updated_at: new Date().toISOString() })
      .eq('id', userId);
    set(state => ({
      profile: state.profile ? { ...state.profile, deleted_at: null } : null,
    }));
  },

  getCompletion: () => {
    const { profile } = get();
    if (!profile) return null;
    return calculateProfileCompletion(profile as unknown as Record<string, unknown>);
  },
}));
