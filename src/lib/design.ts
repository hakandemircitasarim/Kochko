/**
 * KOCHKO DESIGN SYSTEM (2026-08)
 *
 * WHY THIS FILE EXISTS
 *
 * The app had colours and nothing else. `SPACING` topped out at 24, so no section could ever be
 * separated from the next by more than a thumbnail's width. `FONT` ran 13 / 14 / 16 — steps of one
 * and two pixels, which the eye cannot resolve, so a heading and its body text looked like the same
 * thing. And the theme banned shadows outright ("flat dark, no gradients, no shadows, no glow"),
 * which in 2021 read as clean and in 2026 reads as unstyled: every card the same grey rectangle,
 * separated by the same hairline, at the same size.
 *
 * That combination — no size contrast, no spatial contrast, no depth — is why the app feels like a
 * document rather than a product. Hierarchy is not decoration. It is how a reader knows where to
 * look first. Without it every screen asks the user to read everything.
 *
 * WHAT THIS FIXES
 *
 *  1. TYPE  — a real modular scale with usable jumps, shipped as complete text styles (size,
 *             line-height, weight, tracking) rather than loose numbers, so a heading is a decision
 *             made once instead of at 60 call sites.
 *  2. SPACE — a 4pt grid that keeps going past 24, so sections can actually breathe.
 *  3. DEPTH — layered surfaces + restrained shadow. Not skeuomorphism: just enough to say "this
 *             card is nearer to you than the page".
 *  4. MOTION— shared durations and easings, so things that move feel like the same app.
 *
 * HOW TO USE IT
 *
 * Prefer the semantic tokens here over raw numbers. `TYPE.title2` not `fontSize: 24`. The legacy
 * FONT/SPACING/RADIUS scales in constants.ts still exist and are re-tuned to agree with this file,
 * so screens that have not been migrated improve too — but new work should use these.
 */
import type { TextStyle } from 'react-native';
import type { ThemeColors } from './theme';

/* ───────────────────────────── TYPE ───────────────────────────── */

/**
 * Complete text styles, not loose sizes.
 *
 * The ladder is roughly a 1.2 modular scale, rounded to whole pixels and hand-adjusted so adjacent
 * steps are always distinguishable at arm's length: 11 / 13 / 15 / 17 / 20 / 24 / 30 / 40. The old
 * scale had 13→14→16, which is why nothing looked deliberate.
 *
 * Line height is baked in because it is the single most-forgotten property in the app today, and
 * unset line height is what makes Turkish text with descenders (ğ, ş, ç) look cramped.
 *
 * Negative tracking on the large sizes is what keeps big numbers from looking gappy — it is the
 * difference between a dashboard figure that reads as designed and one that reads as default.
 */
export const TYPE = {
  /** Hero figures only — the calorie number, the weight. One per screen, at most. */
  display: { fontSize: 40, lineHeight: 44, fontWeight: '800', letterSpacing: -1.0 },
  /** Screen titles. */
  title1: { fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.6 },
  /** Section headings, card headline figures. */
  title2: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.4 },
  /** Card titles. */
  title3: { fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: -0.2 },
  /** Emphasised row labels, list headers. */
  headline: { fontSize: 17, lineHeight: 23, fontWeight: '600', letterSpacing: -0.1 },
  /** Default reading size. Deliberately 15, not 14 — 14 is a desktop table size. */
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400', letterSpacing: 0 },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600', letterSpacing: 0 },
  /** Secondary copy, helper text. */
  callout: { fontSize: 14, lineHeight: 20, fontWeight: '400', letterSpacing: 0 },
  /** Metadata, timestamps, units. */
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500', letterSpacing: 0 },
  /** Small ALL-CAPS eyebrow labels. Tracking is positive here — caps need air. */
  overline: { fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 0.8 },
  /** The smallest legible step. Never for anything the user must read to act. */
  footnote: { fontSize: 11, lineHeight: 15, fontWeight: '500', letterSpacing: 0.2 },
} as const satisfies Record<string, TextStyle>;

export type TypeToken = keyof typeof TYPE;

/* ───────────────────────────── SPACE ───────────────────────────── */

/**
 * 4pt grid. The important part is the top end: the old scale stopped at 24, which is why every
 * screen reads as one undifferentiated column. Section breaks want 32–48.
 */
export const SPACE = {
  none: 0,
  hair: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  /** Between distinct groups inside a section. */
  section: 32,
  /** Between sections. */
  block: 40,
  /** Screen-level breathing room, empty states. */
  page: 56,
} as const;

/** Standard horizontal page gutter. One number, used everywhere, so screens line up with each other. */
export const GUTTER = SPACE.xl;

/* ───────────────────────────── RADIUS ───────────────────────────── */

/**
 * Slightly rounder than before. 12 on a card reads as "a box"; 16–20 reads as "a surface".
 * `card` and `sheet` are named by ROLE so the app stays internally consistent even if the
 * numbers are retuned later.
 */
export const RADIUS_SCALE = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 32,
  pill: 999,
} as const;

export const RADII = {
  chip: RADIUS_SCALE.sm,
  control: RADIUS_SCALE.md,
  card: RADIUS_SCALE.lg,
  sheet: RADIUS_SCALE.xxl,
  pill: RADIUS_SCALE.pill,
} as const;

/* ───────────────────────────── DEPTH ───────────────────────────── */

/**
 * The old theme forbade shadows on principle. That principle is what makes the app look flat in
 * the pejorative sense: with no depth cue and no size contrast, a tappable card and a static
 * container are visually identical.
 *
 * This is deliberately restrained — dark UIs are ruined by heavy drop shadows. On dark surfaces
 * the lift comes mostly from a lighter background plus a barely-there shadow; on light surfaces
 * the shadow does the work. Returns a plain style object usable on View.
 *
 * MEASURED 2026-08-05 — READ THIS BEFORE REACHING FOR elevation() ON THE DARK THEME.
 * Android ignores shadowColor/shadowOpacity/shadowOffset/shadowRadius entirely; it renders ONLY
 * the `elevation` number below. On the dark theme's #0D0D12 background a black shadow is
 * invisible by construction. This was driven on a device: elevation(1) and elevation(2) were
 * applied to the shared Card and produced NO visible change, so the experiment was reverted.
 * Raising the card fill instead (card #1A1A24 → cardElevated #22222E) is not free either —
 * cardElevated is the same tone as surfaceLight, which is what in-card rows/chips already use,
 * so it would flatten the hierarchy INSIDE cards.
 *
 * What actually carries depth on this app's dark theme is the CARD EDGE: colors.border went
 * 0.08 → 0.16 (see theme.ts) while colors.divider stayed at 0.08, so a group's boundary is
 * definite and its internal separators stay quiet. Keep elevation() for the light theme and for
 * surfaces that genuinely float over content; do not expect it to do anything in the dark.
 *
 * `level`:
 *   0 — flush with the page (list rows, dividers)
 *   1 — resting card
 *   2 — raised / interactive card, bottom sheet
 *   3 — modal, popover, anything over content
 */
export function elevation(level: 0 | 1 | 2 | 3, isDark: boolean) {
  if (level === 0) return {};
  const darkShadow = { shadowColor: '#000', shadowOpacity: [0, 0.28, 0.38, 0.5][level] };
  const lightShadow = { shadowColor: '#0B1220', shadowOpacity: [0, 0.06, 0.1, 0.16][level] };
  const base = isDark ? darkShadow : lightShadow;
  return {
    ...base,
    shadowOffset: { width: 0, height: [0, 2, 6, 14][level] },
    shadowRadius: [0, 6, 16, 32][level],
    // Android reads only this; keep it low — Android elevation also darkens the surface.
    elevation: [0, 2, 5, 12][level],
  };
}

/* ───────────────────────────── MOTION ───────────────────────────── */

/**
 * Two rules: nothing the user initiated should take longer than ~250ms to acknowledge, and
 * everything that moves should share an easing so the app feels like one hand made it.
 */
export const MOTION = {
  /** Press feedback, colour changes. Should feel instant. */
  instant: 120,
  /** Standard enter/exit, expand/collapse. */
  base: 220,
  /** Screen-level transitions, sheets. */
  slow: 320,
  /** Springs for anything the finger is dragging. */
  spring: { damping: 18, stiffness: 220, mass: 0.9 },
  /** Scale a card drops to while pressed. Subtle — 0.98, not 0.9. */
  pressScale: 0.98,
} as const;

/* ───────────────────────────── SURFACES ───────────────────────────── */

/**
 * A card is not just a background colour — it is a background, a hairline, a radius and a lift,
 * and those four have to agree or the result looks accidental. This returns the whole set so a
 * screen cannot get three of them right and one wrong.
 */
export function surface(colors: ThemeColors, isDark: boolean, level: 0 | 1 | 2 | 3 = 1) {
  const bg = level >= 2 ? colors.cardElevated : colors.card;
  return {
    backgroundColor: bg,
    borderRadius: RADII.card,
    borderWidth: StyleSheetHairline,
    borderColor: colors.border,
    ...elevation(level, isDark),
  };
}

/**
 * Hairlines: 0.5 is correct on iOS/@2x+, but Android rounds it to 0 on some densities and the
 * border vanishes — which is why some cards look borderless on certain phones. 1 is safe
 * everywhere and, at these border colours, still reads as a hairline.
 */
export const StyleSheetHairline = 1;

/* ───────────────────────────── HELPERS ───────────────────────────── */

/**
 * Tint a hex colour with alpha, for subtle status backgrounds. Accepts #RGB or #RRGGBB.
 * Returns rgba() so it composites correctly over any surface — unlike the `color + '20'` string
 * concatenation used across the app today, which silently produces an invalid value if the base
 * colour is already 8-digit or is an rgba() string.
 */
export function alpha(hex: string, a: number): string {
  const m = hex.trim().replace('#', '');
  if (m.length !== 3 && m.length !== 6) return hex;
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return hex;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, a))})`;
}
