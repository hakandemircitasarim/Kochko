/**
 * Theme System
 * Modern fitness app palette with gradient support
 */
import { createContext, useContext } from 'react';

export type ThemeMode = 'system' | 'dark' | 'light';

export interface ThemeColors {
  primary: string;
  primaryDark: string;
  primaryLight: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  surfaceLight: string;
  card: string;
  cardElevated: string;
  inputBg: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  success: string;
  successLight: string;
  warning: string;
  warningLight: string;
  error: string;
  errorLight: string;
  border: string;
  divider: string;
  tabBar: string;
  tabBarBorder: string;
  shadow: string;
  progressTrack: string;
}

export const DARK_COLORS: ThemeColors = {
  primary: '#6C63FF',
  primaryDark: '#5A52E0',
  primaryLight: '#8B85FF',
  secondary: '#FF6B6B',
  accent: '#A855F7',
  background: '#0F0F1A',
  surface: '#1A1A2E',
  surfaceLight: '#252542',
  card: '#1A1A2E',
  cardElevated: '#222240',
  inputBg: '#252542',
  text: '#F8FAFC',
  textSecondary: '#CBD5E1',
  textMuted: '#64748B',
  success: '#22C55E',
  successLight: '#052E16',
  warning: '#F59E0B',
  warningLight: '#451A03',
  error: '#EF4444',
  errorLight: '#450A0A',
  border: '#2D2D50',
  divider: '#252542',
  tabBar: '#0F0F1A',
  tabBarBorder: '#2D2D50',
  shadow: '#000000',
  progressTrack: '#3A3A5E',
};

export const LIGHT_COLORS: ThemeColors = {
  primary: '#6C63FF',
  primaryDark: '#5A52E0',
  primaryLight: '#8B85FF',
  secondary: '#FF6B6B',
  accent: '#A855F7',
  background: '#F5F7FA',
  surface: '#FFFFFF',
  surfaceLight: '#F0F2F5',
  card: '#FFFFFF',
  cardElevated: '#FFFFFF',
  inputBg: '#F0F2F5',
  text: '#1A1A2E',
  textSecondary: '#5A6478',
  textMuted: '#94A3B8',
  success: '#16A34A',
  successLight: '#DCFCE7',
  warning: '#D97706',
  warningLight: '#FEF3C7',
  error: '#DC2626',
  errorLight: '#FEE2E2',
  border: '#E8ECF0',
  divider: '#F0F2F5',
  tabBar: '#FFFFFF',
  tabBarBorder: '#E8ECF0',
  shadow: '#000000',
  progressTrack: '#D8DCE4',
};

/** Gradient pairs for metric cards - same in both themes for vibrancy */
export const GRADIENTS = {
  calories: ['#FF6B6B', '#FF8E53'] as [string, string],
  protein: ['#667EEA', '#764BA2'] as [string, string],
  water: ['#56CCF2', '#2F80ED'] as [string, string],
  sleep: ['#A855F7', '#7C3AED'] as [string, string],
  mood: ['#F97316', '#FACC15'] as [string, string],
  steps: ['#22C55E', '#16A34A'] as [string, string],
  weight: ['#EC4899', '#F43F5E'] as [string, string],
  streak: ['#F97316', '#EF4444'] as [string, string],
  carbs: ['#F59E0B', '#FBBF24'] as [string, string],
  fat: ['#EF4444', '#F87171'] as [string, string],
  primary: ['#6C63FF', '#8B85FF'] as [string, string],
  success: ['#22C55E', '#16A34A'] as [string, string],
};

/** Hero section gradient (3-stop for richer effect) */
export const HERO_GRADIENTS = {
  light: ['#6C63FF', '#8B85FF', '#A78BFA'] as [string, string, string],
  dark: ['#4338CA', '#6C63FF', '#8B85FF'] as [string, string, string],
};

export interface ThemeContextType {
  mode: ThemeMode;
  colors: ThemeColors;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
}

export const ThemeContext = createContext<ThemeContextType>({
  mode: 'light',
  colors: LIGHT_COLORS,
  isDark: false,
  setMode: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}
