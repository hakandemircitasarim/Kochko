/**
 * Design System Constants
 * Spec 22: Erişilebilirlik + Spec 22.2: Tema
 *
 * All visual tokens: colors, spacing, typography, shadows, borders, animation.
 * Dark theme is default; light mode prepared but not yet active.
 */

export const COLORS = {
  // Brand
  primary: '#6C63FF',
  primaryDark: '#5A52D5',
  primaryLight: '#8B85FF',
  secondary: '#FF6584',
  secondaryDark: '#D94E6B',

  // Backgrounds
  background: '#0F0F1A',
  surface: '#1A1A2E',
  surfaceLight: '#252545',
  card: '#1E1E3A',
  inputBg: '#252545',
  overlay: 'rgba(0,0,0,0.6)',

  // Text
  text: '#FFFFFF',
  textSecondary: '#A0A0B0',
  textMuted: '#6B6B80',
  textInverse: '#0F0F1A',

  // Semantic
  success: '#4CAF50',
  successDark: '#388E3C',
  successLight: '#81C784',
  warning: '#FF9800',
  warningDark: '#F57C00',
  warningLight: '#FFB74D',
  error: '#F44336',
  errorDark: '#D32F2F',
  errorLight: '#EF9A9A',
  info: '#2196F3',

  // Border
  border: '#2A2A4A',
  borderLight: '#3A3A5A',
  borderFocus: '#6C63FF',

  // Macro colors (consistent across all charts and displays)
  protein: '#6C63FF',
  carbs: '#4CAF50',
  fat: '#FF9800',
  alcohol: '#F44336',
  water: '#2196F3',
  sleep: '#009688',
  steps: '#8BC34A',
  mood: '#FF6584',
} as const;

export const SPACING = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;

export const FONT = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 24,
  xxl: 32,
  hero: 40,
} as const;

export const FONT_WEIGHT = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  extrabold: '800' as const,
};

export const RADIUS = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 999,
} as const;

export const SHADOW = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
} as const;

export const ANIMATION = {
  fast: 150,
  normal: 250,
  slow: 400,
} as const;

// Spec 22.1: Minimum touch target 44x44
export const TOUCH_TARGET = 44;

export const WATER_INCREMENT = 0.25;

// Macro distribution labels
export const MACRO_LABELS = {
  protein: 'Protein',
  carbs: 'Karbonhidrat',
  fat: 'Yag',
  alcohol: 'Alkol',
  calories: 'Kalori',
  water: 'Su',
} as const;

// Meal type labels
export const MEAL_LABELS: Record<string, string> = {
  breakfast: 'Kahvalti',
  lunch: 'Ogle',
  dinner: 'Aksam',
  snack: 'Ara Ogun',
};

// Activity level labels
export const ACTIVITY_LABELS: Record<string, string> = {
  sedentary: 'Hareketsiz',
  light: 'Hafif Aktif',
  moderate: 'Orta Aktif',
  active: 'Aktif',
  very_active: 'Cok Aktif',
};

// Coach tone labels
export const TONE_LABELS: Record<string, string> = {
  strict: 'Sert Koc',
  balanced: 'Dengeli',
  gentle: 'Yumusak',
};

// Goal type labels
export const GOAL_LABELS: Record<string, string> = {
  lose_weight: 'Kilo Ver',
  gain_weight: 'Kilo Al',
  gain_muscle: 'Kas Kazan',
  health: 'Saglikli Yasam',
  maintain: 'Kilo Koru',
  conditioning: 'Kondisyon',
};

// Diet mode labels
export const DIET_LABELS: Record<string, string> = {
  standard: 'Standart',
  low_carb: 'Dusuk Karb',
  keto: 'Ketojenik',
  high_protein: 'Yuksek Protein',
};
