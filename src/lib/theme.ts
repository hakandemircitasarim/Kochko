/**
 * Theme System
 * Flat dark design with teal accent — no gradients, no shadows, no glow
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
  // Macro colors
  protein: string;
  carbs: string;
  fat: string;
  // Utility colors
  purple: string;
  pink: string;
  coral: string;
}

export const DARK_COLORS: ThemeColors = {
  primary: '#1D9E75',
  primaryDark: '#17805E',
  primaryLight: '#1D9E7520',
  secondary: '#7F77DD',
  accent: '#7F77DD',
  background: '#0D0D12',
  surface: '#1A1A24',
  surfaceLight: '#22222E',
  card: '#1A1A24',
  cardElevated: '#22222E',
  inputBg: '#1A1A24',
  text: '#EEEEF0',
  textSecondary: '#9999A8',
  textMuted: '#66667A',
  success: '#1D9E75',
  successLight: '#1D9E7520',
  warning: '#EF9F27',
  warningLight: '#EF9F2720',
  error: '#E24B4A',
  errorLight: '#E24B4A20',
  border: 'rgba(255,255,255,0.08)',
  divider: 'rgba(255,255,255,0.08)',
  tabBar: '#0D0D12',
  tabBarBorder: 'rgba(255,255,255,0.08)',
  shadow: '#000000',
  progressTrack: 'rgba(255,255,255,0.08)',
  // Macro colors
  protein: '#378ADD',
  carbs: '#EF9F27',
  fat: '#D85A30',
  // Utility
  purple: '#7F77DD',
  pink: '#D4537E',
  coral: '#D85A30',
};

export const LIGHT_COLORS: ThemeColors = {
  primary: '#1D9E75',
  primaryDark: '#17805E',
  primaryLight: '#1D9E7520',
  secondary: '#7F77DD',
  accent: '#7F77DD',
  background: '#F5F7FA',
  surface: '#FFFFFF',
  surfaceLight: '#F0F2F5',
  card: '#FFFFFF',
  cardElevated: '#FFFFFF',
  inputBg: '#F0F2F5',
  text: '#1A1A24',
  textSecondary: '#5A6478',
  textMuted: '#94A3B8',
  success: '#1D9E75',
  successLight: '#1D9E7520',
  warning: '#EF9F27',
  warningLight: '#EF9F2720',
  error: '#E24B4A',
  errorLight: '#E24B4A20',
  border: '#E8ECF0',
  divider: '#F0F2F5',
  tabBar: '#FFFFFF',
  tabBarBorder: '#E8ECF0',
  shadow: '#000000',
  progressTrack: '#D8DCE4',
  // Macro colors
  protein: '#378ADD',
  carbs: '#EF9F27',
  fat: '#D85A30',
  // Utility
  purple: '#7F77DD',
  pink: '#D4537E',
  coral: '#D85A30',
};

/** Flat accent colors for metric cards (replaces gradients) */
export const METRIC_COLORS = {
  calories: '#1D9E75',
  protein: '#378ADD',
  carbs: '#EF9F27',
  fat: '#D85A30',
  water: '#378ADD',
  sleep: '#7F77DD',
  mood: '#D4537E',
  steps: '#7F77DD',
  weight: '#D4537E',
  streak: '#EF9F27',
  workout: '#7F77DD',
  challenge: '#7F77DD',
} as const;

/** @deprecated Use METRIC_COLORS instead. Kept for backward compat during migration. */
export const GRADIENTS = {
  calories: ['#1D9E75', '#1D9E75'] as [string, string],
  protein: ['#378ADD', '#378ADD'] as [string, string],
  water: ['#378ADD', '#378ADD'] as [string, string],
  sleep: ['#7F77DD', '#7F77DD'] as [string, string],
  mood: ['#D4537E', '#D4537E'] as [string, string],
  steps: ['#7F77DD', '#7F77DD'] as [string, string],
  weight: ['#D4537E', '#D4537E'] as [string, string],
  streak: ['#EF9F27', '#EF9F27'] as [string, string],
  carbs: ['#EF9F27', '#EF9F27'] as [string, string],
  fat: ['#D85A30', '#D85A30'] as [string, string],
  primary: ['#1D9E75', '#1D9E75'] as [string, string],
  success: ['#1D9E75', '#1D9E75'] as [string, string],
};

/** @deprecated Gradients removed — flat design only */
export const HERO_GRADIENTS = {
  light: ['#1D9E75', '#1D9E75', '#1D9E75'] as [string, string, string],
  dark: ['#1D9E75', '#1D9E75', '#1D9E75'] as [string, string, string],
};

export interface ThemeContextType {
  mode: ThemeMode;
  colors: ThemeColors;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
}

export const ThemeContext = createContext<ThemeContextType>({
  mode: 'dark',
  colors: DARK_COLORS,
  isDark: true,
  setMode: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}
