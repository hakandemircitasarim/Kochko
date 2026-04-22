/**
 * Plan tab — slot for the central FAB only (see (tabs)/_layout.tsx).
 *
 * The FAB intercepts taps, so this screen is essentially never rendered.
 * If something does navigate to /(tabs)/plan directly, redirect to home —
 * the dashboard now surfaces both plan cards inline.
 */
import { Redirect } from 'expo-router';

export default function PlanTabRedirect() {
  return <Redirect href="/(tabs)" />;
}
