import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { Session, User } from '@supabase/supabase-js';
import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

WebBrowser.maybeCompleteAuthSession();

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  initialized: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, birthYear: number) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signInWithApple: () => Promise<{ error: string | null }>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  initialize: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  loading: false,
  initialized: false,

  initialize: async () => {
    const { data } = await supabase.auth.getSession();
    set({ session: data.session, user: data.session?.user ?? null, initialized: true });
    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session, user: session?.user ?? null });
    });
  },

  signIn: async (email, password) => {
    set({ loading: true });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    set({ loading: false });
    return { error: error?.message ?? null };
  },

  signUp: async (email, password, birthYear) => {
    // Spec 1.1: Age verification - must be 18+
    const age = new Date().getFullYear() - birthYear;
    if (age < 18) {
      return { error: 'Bu uygulama 18 yaş ve üzeri içindir.' };
    }

    set({ loading: true });
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { birth_year: birthYear } },
    });
    set({ loading: false });
    return { error: error?.message ?? null };
  },

  signInWithGoogle: async () => {
    set({ loading: true });
    try {
      const redirectTo = makeRedirectUri({ scheme: 'kochko' });
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) { set({ loading: false }); return { error: error.message }; }
      if (data.url) {
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type === 'success' && result.url) {
          const url = new URL(result.url);
          const accessToken = url.searchParams.get('access_token') ?? url.hash?.match(/access_token=([^&]*)/)?.[1];
          const refreshToken = url.searchParams.get('refresh_token') ?? url.hash?.match(/refresh_token=([^&]*)/)?.[1];
          if (accessToken && refreshToken) {
            await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          }
        }
      }
      set({ loading: false });
      return { error: null };
    } catch (e) {
      set({ loading: false });
      return { error: 'Google ile giris sirasinda hata olustu.' };
    }
  },

  signInWithApple: async () => {
    if (Platform.OS !== 'ios') {
      return { error: 'Apple ile giris sadece iOS cihazlarda kullanilabilir.' };
    }
    set({ loading: true });
    try {
      const redirectTo = makeRedirectUri({ scheme: 'kochko' });
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) { set({ loading: false }); return { error: error.message }; }
      if (data.url) {
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type === 'success' && result.url) {
          const url = new URL(result.url);
          const accessToken = url.searchParams.get('access_token') ?? url.hash?.match(/access_token=([^&]*)/)?.[1];
          const refreshToken = url.searchParams.get('refresh_token') ?? url.hash?.match(/refresh_token=([^&]*)/)?.[1];
          if (accessToken && refreshToken) {
            await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          }
        }
      }
      set({ loading: false });
      return { error: null };
    } catch (e) {
      set({ loading: false });
      return { error: 'Apple ile giris sirasinda hata olustu.' };
    }
  },

  resetPassword: async (email) => {
    set({ loading: true });
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: makeRedirectUri({ scheme: 'kochko', path: 'reset-password' }),
    });
    set({ loading: false });
    return { error: error?.message ?? null };
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null });
  },
}));
