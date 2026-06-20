/**
 * Haptics — thin wrapper over expo-haptics so call sites stay one-liners and degrade
 * gracefully on devices without a Taptic engine (the import/await never throws).
 *
 * Usage: import { haptics } from '@/lib/haptics';
 *   haptics.tap()      → light selection (chip/toggle/quick action)
 *   haptics.success()  → a log/save committed
 *   haptics.warning()  → a guarded/blocked action
 *   haptics.error()    → a failure
 *   haptics.heavy()    → milestone / celebration
 */
import * as Haptics from 'expo-haptics';

function safe(fn: () => Promise<unknown>) {
  try { void fn(); } catch { /* no taptic engine — no-op */ }
}

export const haptics = {
  tap: () => safe(() => Haptics.selectionAsync()),
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  light: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  medium: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  heavy: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
};
