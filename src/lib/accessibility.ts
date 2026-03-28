/**
 * Accessibility Helpers
 * Spec 22: Erişilebilirlik ve görsel tercihler
 *
 * Provides accessible labels, roles, and hints for React Native components.
 */
import { AccessibilityRole } from 'react-native';

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
 * Compliance score color for both visual and screen reader.
 */
export function complianceDescription(score: number): string {
  if (score >= 80) return `Cok iyi: ${score} puan`;
  if (score >= 60) return `Iyi: ${score} puan`;
  if (score >= 40) return `Orta: ${score} puan`;
  return `Dusuk: ${score} puan`;
}
