/**
 * Lightweight crash + error reporting bridge.
 *
 * Designed to be a no-op until `EXPO_PUBLIC_SENTRY_DSN` is set in the build
 * environment. When a DSN is present, we use `@sentry/react-native` (which the
 * caller is expected to install + add to `app.config.js` plugins array). When
 * not, we fall back to a local ring buffer of the last 50 errors so
 * `getRecentErrors()` can surface them in the Debug screen even without a
 * network-backed service.
 *
 * Usage (call once at app start, in `app/_layout.tsx`):
 *   await initSentry();
 *
 * For manual reporting:
 *   reportError(err, { context: 'ai-chat.send' });
 */
import Constants from 'expo-constants';

type ErrorRecord = {
  at: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
};

const recentErrors: ErrorRecord[] = [];
const MAX_BUFFER = 50;

let initialized = false;
let sentryLib: { captureException: (e: unknown, scope?: unknown) => void } | null = null;

export async function initSentry(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const dsn = (Constants.expoConfig?.extra?.sentryDsn as string | undefined) ?? process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    // Fallback mode — reporting is local only.
    return;
  }

  try {
    // Dynamic import so the binary is skipped in environments without the package installed.
    // Install with: npm install @sentry/react-native && npx @sentry/wizard@latest -s -i reactNative
    // @ts-expect-error — optional dep
    const Sentry = await import('@sentry/react-native');
    Sentry.init({
      dsn,
      tracesSampleRate: 0.2,
      enableAutoSessionTracking: true,
      environment: __DEV__ ? 'development' : 'production',
    });
    sentryLib = Sentry as unknown as typeof sentryLib;
  } catch {
    // Package not installed yet; stay in fallback mode. Not an error.
  }
}

export function reportError(err: unknown, context?: Record<string, unknown>): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  recentErrors.push({ at: new Date().toISOString(), message, stack, context });
  if (recentErrors.length > MAX_BUFFER) recentErrors.shift();

  if (sentryLib) {
    try {
      sentryLib.captureException(err, context ? { contexts: { extra: context } } : undefined);
    } catch { /* drop silently */ }
  }

  // Always also emit to console for local dev
  if (__DEV__) {
    console.warn('[kochko:error]', message, context ?? '');
  }
}

/**
 * Retrieve the local ring buffer. Intended for the Debug Mode settings screen.
 */
export function getRecentErrors(): ReadonlyArray<ErrorRecord> {
  return recentErrors;
}

export function isSentryActive(): boolean {
  return sentryLib !== null;
}

/**
 * Halka tamponu boşalt — gönderilecek kayıtları döndürür ve tamponu temizler.
 * Gönderim başarısız olursa çağıran `restoreErrors` ile geri koyabilir.
 */
export function drainErrors(): ErrorRecord[] {
  const out = recentErrors.splice(0, recentErrors.length);
  return out;
}

/** Gönderim başarısızsa kayıtları tampona geri koy (sıra korunur, taşma budanır). */
export function restoreErrors(records: ErrorRecord[]): void {
  recentErrors.unshift(...records);
  if (recentErrors.length > MAX_BUFFER) recentErrors.splice(0, recentErrors.length - MAX_BUFFER);
}
