/**
 * Accessibility Helpers
 * Spec 22: Erişilebilirlik ve görsel tercihler
 *
 * Provides accessible labels, roles, and hints for React Native components.
 * WCAG AA compliant contrast helpers, screen reader formatting,
 * and minimum touch target enforcement.
 */
import { AccessibilityRole } from 'react-native';

// ────────────────────────────── Constants ──────────────────────────────

/**
 * Minimum touch target size in dp (WCAG 2.5.5 / Apple HIG / Material).
 */
export const TOUCH_TARGET_SIZE = 44;

/**
 * Unit display names for screen readers (Turkish).
 * Maps compact abbreviation -> spoken form.
 */
const SCREEN_READER_UNITS: Record<string, string> = {
  kg: 'kilogram',
  g: 'gram',
  mg: 'miligram',
  L: 'litre',
  ml: 'mililitre',
  kcal: 'kilokalori',
  cm: 'santimetre',
  bpm: 'kalp atisi',
  dk: 'dakika',
  saat: 'saat',
  gun: 'gun',
  adim: 'adim',
  '%': 'yuzde',
};

// ────────────────────────────── Core a11y props ──────────────────────────────

/**
 * Generate accessibility props for interactive elements.
 */
export function a11y(label: string, options?: {
  role?: AccessibilityRole;
  hint?: string;
  state?: { disabled?: boolean; selected?: boolean; checked?: boolean };
}) {
  return {
    accessible: true,
    accessibilityLabel: label,
    accessibilityRole: options?.role ?? ('button' as AccessibilityRole),
    accessibilityHint: options?.hint,
    accessibilityState: options?.state,
  };
}

/**
 * Generate generic accessibility props with label and optional hint.
 */
export function getAccessibilityProps(label: string, hint?: string) {
  return {
    accessible: true,
    accessibilityLabel: label,
    accessibilityHint: hint,
  };
}

/**
 * Generate accessibility props specifically for button elements.
 */
export function getButtonA11yProps(label: string, hint?: string) {
  return {
    accessible: true,
    accessibilityLabel: label,
    accessibilityHint: hint,
    accessibilityRole: 'button' as AccessibilityRole,
  };
}

/**
 * Generate accessibility props for text/heading elements.
 */
export function a11yText(label: string, isHeading: boolean = false) {
  return {
    accessible: true,
    accessibilityLabel: label,
    accessibilityRole: (isHeading ? 'header' : 'text') as AccessibilityRole,
  };
}

/**
 * Generate accessibility props for image elements.
 */
export function a11yImage(label: string) {
  return {
    accessible: true,
    accessibilityLabel: label,
    accessibilityRole: 'image' as AccessibilityRole,
  };
}

/**
 * Generate accessibility props for link elements.
 */
export function a11yLink(label: string, hint?: string) {
  return {
    accessible: true,
    accessibilityLabel: label,
    accessibilityHint: hint,
    accessibilityRole: 'link' as AccessibilityRole,
  };
}

/**
 * Generate accessibility props for progress indicators.
 */
export function a11yProgress(label: string, value: number, max: number) {
  return {
    accessible: true,
    accessibilityLabel: `${label}: ${value} / ${max}`,
    accessibilityRole: 'progressbar' as AccessibilityRole,
    accessibilityValue: {
      min: 0,
      max,
      now: value,
      text: `${Math.round((value / max) * 100)}%`,
    },
  };
}

/**
 * Generate accessibility props for switch/toggle elements.
 */
export function a11ySwitch(label: string, isOn: boolean) {
  return {
    accessible: true,
    accessibilityLabel: label,
    accessibilityRole: 'switch' as AccessibilityRole,
    accessibilityState: { checked: isOn },
  };
}

/**
 * Generate accessibility props for tab elements.
 */
export function a11yTab(label: string, isSelected: boolean) {
  return {
    accessible: true,
    accessibilityLabel: label,
    accessibilityRole: 'tab' as AccessibilityRole,
    accessibilityState: { selected: isSelected },
  };
}

// ────────────────────────────── Contrast & Color ──────────────────────────────

/**
 * Parse a hex color string to RGB components.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  if (clean.length === 6) {
    return {
      r: parseInt(clean.substring(0, 2), 16),
      g: parseInt(clean.substring(2, 4), 16),
      b: parseInt(clean.substring(4, 6), 16),
    };
  }
  return null;
}

/**
 * Calculate relative luminance per WCAG 2.0 formula.
 * Returns value between 0 (black) and 1 (white).
 */
export function getRelativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;

  const [rs, gs, bs] = [rgb.r / 255, rgb.g / 255, rgb.b / 255].map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Return 'white' or 'black' for best contrast against the given background.
 * Uses WCAG relative luminance calculation.
 */
export function getContrastColor(bgColor: string): 'white' | 'black' {
  const luminance = getRelativeLuminance(bgColor);
  // Threshold: luminance > 0.179 means the bg is "light"
  return luminance > 0.179 ? 'black' : 'white';
}

/**
 * Calculate WCAG contrast ratio between two colors.
 * Returns value between 1 (identical) and 21 (black on white).
 */
export function getContrastRatio(color1: string, color2: string): number {
  const l1 = getRelativeLuminance(color1);
  const l2 = getRelativeLuminance(color2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check if a color pair meets WCAG AA standard (4.5:1 for normal text).
 */
export function meetsContrastAA(fg: string, bg: string, isLargeText = false): boolean {
  const ratio = getContrastRatio(fg, bg);
  return isLargeText ? ratio >= 3.0 : ratio >= 4.5;
}

// ────────────────────────────── Screen Reader Formatting ──────────────────────────────

/**
 * Format a numeric value + unit for screen reader consumption.
 * Expands abbreviations to full Turkish words:
 *   75 kg -> "75 kilogram"
 *   1800 kcal -> "1800 kilokalori"
 *   2.5 L -> "2.5 litre"
 */
export function formatForScreenReader(value: number, unit: string): string {
  const spoken = SCREEN_READER_UNITS[unit] ?? unit;
  return `${value} ${spoken}`;
}

/**
 * Format a range for screen reader: "1400 ile 1800 kilokalori arasi".
 */
export function formatRangeForScreenReader(
  min: number,
  max: number,
  unit: string
): string {
  const spoken = SCREEN_READER_UNITS[unit] ?? unit;
  return `${min} ile ${max} ${spoken} arasi`;
}

/**
 * Format a progress fraction for screen reader.
 * "1450 / 1800 kilokalori, yuzde 81"
 */
export function formatProgressForScreenReader(
  current: number,
  target: number,
  unit: string
): string {
  const spoken = SCREEN_READER_UNITS[unit] ?? unit;
  const pct = target > 0 ? Math.round((current / target) * 100) : 0;
  return `${current} / ${target} ${spoken}, yuzde ${pct}`;
}

// ────────────────────────────── Score Descriptions ──────────────────────────────

/**
 * Compliance score color for both visual and screen reader.
 */
export function complianceDescription(score: number): string {
  if (score >= 80) return `Cok iyi: ${score} puan`;
  if (score >= 60) return `Iyi: ${score} puan`;
  if (score >= 40) return `Orta: ${score} puan`;
  return `Dusuk: ${score} puan`;
}

/**
 * Minimum touch target style to enforce 44dp hit areas.
 */
export function getTouchTargetStyle() {
  return {
    minWidth: TOUCH_TARGET_SIZE,
    minHeight: TOUCH_TARGET_SIZE,
  };
}
