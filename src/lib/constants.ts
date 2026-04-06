import { DARK_COLORS } from './theme';

// Default colors (dark theme) - used as fallback when ThemeContext not available.
// In components, prefer useTheme().colors for dynamic theme support.
export const COLORS = DARK_COLORS;

export const SPACING = { xs: 4, sm: 8, md: 12, lg: 14, xl: 16, xxl: 24 } as const;
export const FONT = { xs: 11, sm: 13, md: 14, lg: 16, xl: 20, xxl: 24, hero: 28 } as const;
export const RADIUS = { sm: 8, md: 12, lg: 16, xl: 24, xxl: 24, pill: 99, full: 999 } as const;
export const WATER_INCREMENT = 0.25;

/** Card border style for dark theme (no shadows, thin border) */
export const CARD_BORDER = {
  borderWidth: 0.5,
  borderColor: 'rgba(255,255,255,0.08)',
} as const;

/** @deprecated Use CARD_BORDER instead — flat design, no shadows */
export const CARD_SHADOW = CARD_BORDER;

/** Hero section sizing */
export const HERO = {
  RING_SIZE: 170,
  RING_STROKE: 12,
  STAT_CARD_WIDTH: 110,
  STAT_CARD_HEIGHT: 84,
  TIMELINE_DOT_SIZE: 10,
  TIMELINE_LINE_WIDTH: 2,
} as const;

/** @deprecated No elevation in flat design */
export const ELEVATED_SHADOW = CARD_BORDER;
