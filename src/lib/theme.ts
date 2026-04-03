/**
 * Theme System
 * Spec 22.2: Dark/Light theme support with system preference tracking.
 */
import { createContext, useContext } from 'react';

export type ThemeMode = 'system' | 'dark' | 'light';

export interface ThemeColors {
  primary: string;
  primaryDark: string;
  secondary: string;
  background: string;
  surface: string;
  surfaceLight: string;
  card: string;
  inputBg: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  success: string;
  warning: string;
  error: string;
  border: string;
}

export const DARK_COLORS: ThemeColors = {
  primary: '#6C63FF',
  primaryDark: '#5A52D5',
  secondary: '#FF6584',
  background: '#0F0F1A',
  surface: '#1A1A2E',
  surfaceLight: '#252545',
  card: '#1E1E3A',
  inputBg: '#252545',
  text: '#FFFFFF',
  textSecondary: '#A0A0B0',
  textMuted: '#6B6B80',
  success: '#4CAF50',
  warning: '#FF9800',
  error: '#F44336',
  border: '#2A2A4A',
};

export const LIGHT_COLORS: ThemeColors = {
  primary: '#6C63FF',
  primaryDark: '#5A52D5',
  secondary: '#FF6584',
  background: '#F5F5FA',
  surface: '#FFFFFF',
  surfaceLight: '#EDEDF4',
  card: '#FFFFFF',
  inputBg: '#EDEDF4',
  text: '#1A1A2E',
  textSecondary: '#6B6B80',
  textMuted: '#A0A0B0',
  success: '#4CAF50',
  warning: '#FF9800',
  error: '#F44336',
  border: '#D8D8E8',
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
