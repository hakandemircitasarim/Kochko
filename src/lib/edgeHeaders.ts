import Constants from 'expo-constants';

/**
 * Headers every edge-function invocation carries (plan v2, F0 · A00).
 *
 * WHY: an APK stays on a phone for weeks. The server therefore talks to several client versions at
 * once and today has NO way to know which — so it cannot skip a field an old build would choke on,
 * and "how many users are still on the build that can't render X?" is unanswerable. One header
 * makes the asymmetry visible before it becomes a support ticket.
 *
 * Kept deliberately tiny: no device id, no locale, nothing that turns a debugging aid into a
 * tracking surface.
 */
export function edgeHeaders(): Record<string, string> {
  const version = (Constants.expoConfig?.version as string | undefined) ?? 'unknown';
  return { 'x-app-version': version };
}
