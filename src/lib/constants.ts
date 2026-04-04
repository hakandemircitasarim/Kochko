import { DARK_COLORS } from './theme';

// Default colors (dark theme) - used as fallback when ThemeContext not available.
export const COLORS = DARK_COLORS;

export const SPACING = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;
export const FONT = { xs: 11, sm: 13, md: 15, lg: 17, xl: 22, xxl: 28, hero: 34 } as const;
export const RADIUS = { sm: 8, md: 12, lg: 16, xl: 20, full: 999 } as const;
export const WATER_INCREMENT = 0.25;
