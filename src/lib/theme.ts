/**
 * Theme System
 * Electric Blue + Orange - Sporcu/Enerji paleti
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
}

export const DARK_COLORS: ThemeColors = {
  primary: '#3B82F6',        // Electric blue
  primaryDark: '#2563EB',
  primaryLight: '#60A5FA',
  secondary: '#F97316',      // Vibrant orange
  accent: '#A855F7',         // Purple for special
  background: '#0A0A14',     // Deep navy-black
  surface: '#13132A',        // Slightly lighter
  surfaceLight: '#1E1E3D',   // Interactive surfaces
  card: '#13132A',
  cardElevated: '#1A1A36',
  inputBg: '#1E1E3D',
  text: '#F8FAFC',           // Crisp white
  textSecondary: '#CBD5E1',  // Slate-300
  textMuted: '#64748B',      // Slate-500
  success: '#22C55E',        // Green
  successLight: '#052E16',
  warning: '#F59E0B',        // Amber
  warningLight: '#451A03',
  error: '#EF4444',          // Red
  errorLight: '#450A0A',
  border: '#1E293B',         // Slate-800
  divider: '#1E1E3D',
  tabBar: '#0A0A14',
  tabBarBorder: '#1E293B',
};

export const LIGHT_COLORS: ThemeColors = {
  primary: '#2563EB',
  primaryDark: '#1D4ED8',
  primaryLight: '#60A5FA',
  secondary: '#EA580C',
  accent: '#7C3AED',
  background: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceLight: '#F1F5F9',
  card: '#FFFFFF',
  cardElevated: '#FFFFFF',
  inputBg: '#F1F5F9',
  text: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',
  success: '#16A34A',
  successLight: '#DCFCE7',
  warning: '#D97706',
  warningLight: '#FEF3C7',
  error: '#DC2626',
  errorLight: '#FEE2E2',
  border: '#E2E8F0',
  divider: '#F1F5F9',
  tabBar: '#FFFFFF',
  tabBarBorder: '#E2E8F0',
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
