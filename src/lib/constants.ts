import { DARK_COLORS } from './theme';

// Default colors (dark theme) - used as fallback when ThemeContext not available.
// In components, prefer useTheme().colors for dynamic theme support.
export const COLORS = DARK_COLORS;

// RE-TUNED 2026-08 (see src/lib/design.ts for the reasoning).
//
// The previous series stopped at 24 and contained a deliberate off-grid half-step (`lg: 14`). Both
// were defended on the grounds that changing them would "re-pad the whole app" — which is exactly
// what needed to happen: with no value above 24, no section could be separated from the next by
// more than a thumbnail's width, so every screen read as one undifferentiated column. That is the
// single biggest reason the app looks like a document instead of a product.
//
// `lg` is back on the 4dp grid (14 → 16) and the top end finally exists. Padding growing is the
// safe direction for a layout: content gets more room, it does not get clipped.
//
// New code should prefer SPACE from design.ts, which is the same ladder with role names.
export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 36, huge: 48 } as const;
// `xl2: 18` fills the 16→20 gap so authors stop reaching for raw fontSize:18 on
// sub-headings; existing steps are unchanged to avoid shifting current layouts.
// FIX (audit UI-DS-06): keys are ordered to match their values (11→28), so the
// literal reads monotonically. NB the name `xl2` is SMALLER than `xl` (18 < 20) —
// it is the in-between sub-heading step, NOT "extra-extra-large". Pick by value.
export const FONT = { xs: 11, sm: 13, md: 14, lg: 16, xl2: 18, xl: 20, xxl: 24, hero: 28 } as const;
// RE-TUNED 2026-08. Rounder by one step across the board: at 12 a card reads as "a box", at 18 it
// reads as "a surface". `xxl` is no longer a duplicate of `xl` — it now has its own value for
// sheets and modals. `pill`/`full` both mean fully-round and both remain in live use.
export const RADIUS = { sm: 10, md: 14, lg: 18, xl: 24, xxl: 32, pill: 999, full: 999 } as const;
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

/** @deprecated Use CARD_BORDER instead — flat design, no shadows.
 *  Kept only because ActivityTimeline.tsx + settings/coach-memory.tsx still import it. */
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

// FIX (audit UI-DS-05): Button derived its sm/md/lg heights as inline literals
// (32/40/48). Tokenize them so the touch-target sizes live with the other scale
// constants and can be referenced/audited in one place.
export const BUTTON_HEIGHTS = { sm: 32, md: 40, lg: 48 } as const;
