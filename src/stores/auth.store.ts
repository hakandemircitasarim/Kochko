/**
 * Auth Store — Spec 1.1-1.2
 * Manages authentication state: session, sign in/up/out, token refresh.
 * Supabase handles token persistence via AsyncStorage automatically.
 * Age verification (18+) enforced at signup.
 */
import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { Session, User } from '@supabase/supabase-js';

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  initialized: boolean;

  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, birthYear: number) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  loading: false,
  initialized: false,

  /**
   * Initialize auth: restore session from storage, listen for changes.
   * Spec 1.2: "Beni hatırla" varsayılan açık — Supabase AsyncStorage handles this.
   */
  initialize: async () => {
    try {
      const { data } = await supabase.auth.getSession();
      set({ session: data.session, user: data.session?.user ?? null, initialized: true });

      // Listen for auth state changes (login, logout, token refresh)
      supabase.auth.onAuthStateChange((event, session) => {
        set({ session, user: session?.user ?? null });

        // Spec 1.2: Token refreshed automatically by Supabase on activity
        if (event === 'TOKEN_REFRESHED') {
          // Session auto-renewed, no action needed
        }

        // Spec 1.4: If user re-logs during 30-day deletion grace period,
        // account is reactivated (handled by backend)
        if (event === 'SIGNED_IN') {
          // Check if account was pending deletion — backend handles reactivation
        }
      });
    } catch {
      set({ initialized: true }); // Initialize even on error so app doesn't hang
    }
  },

  /**
   * Email + password sign in.
   */
  signIn: async (email, password) => {
    set({ loading: true });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    set({ loading: false });

    if (error) {
      // User-friendly Turkish error messages
      if (error.message.includes('Invalid login')) return { error: 'E-posta veya sifre hatali.' };
      if (error.message.includes('Email not confirmed')) return { error: 'E-posta dogrulanmamis. Gelen kutunu kontrol et.' };
      return { error: error.message };
    }

    set({ session: data.session, user: data.session?.user ?? null });
    return { error: null };
  },

  /**
   * Email + password signup with age verification.
   * Spec 1.1: 18 yaş altı engellenir.
   */
  signUp: async (email, password, birthYear) => {
    const age = new Date().getFullYear() - birthYear;
    if (age < 18) return { error: 'Bu uygulama 18 yas ve uzeri icindir.' };
    if (age > 120) return { error: 'Gecerli bir dogum yili gir.' };

    set({ loading: true });
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { birth_year: birthYear },
        // Spec 1.1: Email verification required before full access
      },
    });
    set({ loading: false });

    if (error) {
      if (error.message.includes('already registered')) return { error: 'Bu e-posta zaten kayitli.' };
      if (error.message.includes('password')) return { error: 'Sifre en az 6 karakter olmali.' };
      return { error: error.message };
    }

    return { error: null };
  },

  /**
   * Sign out and clear state.
   */
  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null });
  },

  /**
   * Manually refresh session token.
   * Spec 1.2: Token 30 gün geçerli, her aktif kullanımda yenilenir.
   */
  refreshSession: async () => {
    const { data } = await supabase.auth.refreshSession();
    if (data.session) {
      set({ session: data.session, user: data.session.user });
    }
  },
}));
