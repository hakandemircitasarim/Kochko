import { DARK_COLORS } from './theme';

// Default colors (dark theme) - used as fallback when ThemeContext not available.
// In components, prefer useTheme().colors for dynamic theme support.
export const COLORS = DARK_COLORS;

// FIX (audit UI-DS-04): `lg: 14` is an intentional half-step, not a 4dp-grid
// error — it is the primary content padding in Card.tsx and many screens. Bumping
// it to 16 would re-pad the whole app and shift current layouts, so the series is
// left as-is by design. New code should still prefer the 4dp values (xs/sm/md/xl/xxl).
export const SPACING = { xs: 4, sm: 8, md: 12, lg: 14, xl: 16, xxl: 24 } as const;
// `xl2: 18` fills the 16→20 gap so authors stop reaching for raw fontSize:18 on
// sub-headings; existing steps are unchanged to avoid shifting current layouts.
// FIX (audit UI-DS-06): keys are ordered to match their values (11→28), so the
// literal reads monotonically. NB the name `xl2` is SMALLER than `xl` (18 < 20) —
// it is the in-between sub-heading step, NOT "extra-extra-large". Pick by value.
export const FONT = { xs: 11, sm: 13, md: 14, lg: 16, xl2: 18, xl: 20, xxl: 24, hero: 28 } as const;
// FIX (audit UI-DS-04): `xxl` is an alias of `xl` (both 24) kept only for call-site
// symmetry with SPACING/FONT — prefer `xl`. `pill` (99) and `full` (999) are both
// "fully round"; both are in live use (pill: StreakBadge, full: elsewhere) so neither
// is removed here to avoid cross-file breakage — treat `full` as the canonical one.
export const RADIUS = { sm: 8, md: 12, lg: 16, xl: 24, xxl: 24, pill: 99, full: 999 } as const;
export const WATER_INCREMENT = 0.25;

/**
 * Max OS text-scale multiplier for Dynamic Type. Tightly-constrained chips,
 * badges, fixed-height pills, and progress labels should pass this to
 * <Text maxFontSizeMultiplier={MAX_FONT_SCALE}> so a raised system font size
 * (130–150%) does not clip or overlap. Body/label copy can scale freely.
 */
export const MAX_FONT_SCALE = 1.3;

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
