import { DARK_COLORS } from './theme';

// Default colors (dark theme) - used as fallback when ThemeContext not available.
// Components should prefer useTheme().colors for theme-aware rendering.
export const COLORS = DARK_COLORS;

export const SPACING = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;
export const FONT = { xs: 12, sm: 14, md: 16, lg: 18, xl: 24, xxl: 32, hero: 40 } as const;
export const WATER_INCREMENT = 0.25;
