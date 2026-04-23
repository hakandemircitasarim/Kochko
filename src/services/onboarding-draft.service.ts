/**
 * Onboarding draft — persists the welcome-slide step + quick-form values to
 * AsyncStorage so a user who kills the app (or whose phone runs out of
 * battery) mid-onboarding can resume where they left off.
 *
 * Cleared on successful completion (clearOnboardingDraft) or when the user
 * signs out.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@kochko_onboarding_draft';

export interface OnboardingDraft {
  step: number;
  heightCm?: string;
  weightKg?: string;
  targetWeightKg?: string;
  gender?: string;
  goalType?: string;
  activity?: string;
}

export async function loadOnboardingDraft(): Promise<OnboardingDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.step === 'number') {
      return parsed as OnboardingDraft;
    }
    return null;
  } catch {
    // Corrupt JSON — drop the key so we don't keep failing forever.
    await AsyncStorage.removeItem(KEY).catch(() => {});
    return null;
  }
}

export async function saveOnboardingDraft(draft: OnboardingDraft): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Full disk / locked keychain — not recoverable; silently drop. Worst
    // case user re-enters their height if they bail.
  }
}

export async function clearOnboardingDraft(): Promise<void> {
  await AsyncStorage.removeItem(KEY).catch(() => {});
}
