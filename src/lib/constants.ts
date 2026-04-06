import { LIGHT_COLORS } from './theme';

// Default colors (light theme) - used as fallback when ThemeContext not available.
// In components, prefer useTheme().colors for dynamic theme support.
export const COLORS = LIGHT_COLORS;

export const SPACING = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;
export const FONT = { xs: 11, sm: 13, md: 15, lg: 17, xl: 22, xxl: 28, hero: 34 } as const;
export const RADIUS = { sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, full: 999 } as const;
export const WATER_INCREMENT = 0.25;

/** Card shadow for light theme depth */
export const CARD_SHADOW = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.10,
  shadowRadius: 10,
  elevation: 3,
} as const;

/** Hero section sizing */
export const HERO = {
  RING_SIZE: 170,
  RING_STROKE: 14,
  STAT_CARD_WIDTH: 110,
  STAT_CARD_HEIGHT: 84,
  TIMELINE_DOT_SIZE: 10,
  TIMELINE_LINE_WIDTH: 2,
} as const;

/** Stronger shadow for elevated elements */
export const ELEVATED_SHADOW = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.1,
  shadowRadius: 12,
  elevation: 5,
} as const;
