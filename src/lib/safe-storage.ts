/**
 * Safe wrappers around AsyncStorage that:
 *   - never throw (caller gets null / default on corruption or device errors),
 *   - auto-delete corrupt JSON so a bad write doesn't keep crashing on read,
 *   - centralize the try/catch boilerplate otherwise duplicated everywhere.
 *
 * Use these instead of calling AsyncStorage directly for anything that is
 * non-critical (caches, UI preferences, draft state, etc.).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export async function safeGetString(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function safeSetString(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    // Full disk / locked keychain — nothing useful to do, caller shouldn't crash.
  }
}

export async function safeGetJSON<T>(key: string, isValid?: (v: unknown) => v is T): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (isValid && !isValid(parsed)) {
      // Schema changed or data was never the right shape — drop it quietly.
      await AsyncStorage.removeItem(key).catch(() => {});
      return null;
    }
    return parsed as T;
  } catch {
    // Parse error — wipe the corrupt entry so we don't keep failing.
    await AsyncStorage.removeItem(key).catch(() => {});
    return null;
  }
}

export async function safeSetJSON(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // See safeSetString.
  }
}

export async function safeRemove(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch { /* best-effort */ }
}
