/**
 * Global error handler — wires React Native's built-in uncaught exception
 * and Promise rejection trackers to our analytics buffer so issues don't
 * vanish silently in production.
 *
 * Not a replacement for Sentry/remote logging, but removes the zero-visibility
 * default where unhandled rejections are only visible in a dev console.
 */
import { trackEvent } from './analytics.service';

type RejectionTracking = {
  enable: (opts: {
    allRejections?: boolean;
    onUnhandled: (id: number, error: unknown) => void;
    onHandled: (id: number) => void;
  }) => void;
};

type ErrorUtilsLike = {
  getGlobalHandler?: () => ((err: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler: (fn: (err: unknown, isFatal?: boolean) => void) => void;
};

let installed = false;

export function installGlobalErrorHandlers(): void {
  if (installed) return;
  installed = true;

  // 1. Uncaught JS errors (synchronous or async without .catch that bubble up).
  const errorUtils = (globalThis as unknown as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (errorUtils?.setGlobalHandler) {
    const previous = errorUtils.getGlobalHandler?.();
    errorUtils.setGlobalHandler((err, isFatal) => {
      const e = err as Error;
      trackEvent('uncaught_error', {
        message: e?.message ?? String(err),
        stack: e?.stack,
        is_fatal: !!isFatal,
      });
      previous?.(err, isFatal);
    });
  }

  // 2. Unhandled Promise rejections. React Native bundles the 'promise' package
  // with a rejection-tracking module; enabling it surfaces rejections that
  // otherwise only appear in a yellowbox in dev and nowhere in release.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tracking = require('promise/setimmediate/rejection-tracking') as RejectionTracking;
    tracking.enable({
      allRejections: true,
      onUnhandled: (id, error) => {
        const e = error as Error;
        trackEvent('unhandled_rejection', {
          rejection_id: id,
          message: e?.message ?? String(error),
          stack: e?.stack,
        });
        if (__DEV__) console.warn('[UnhandledRejection]', id, error);
      },
      onHandled: () => { /* ignore late-handled rejections */ },
    });
  } catch {
    // If the module path changes in a future RN version, fall back silently;
    // the ErrorUtils handler still covers synchronous uncaught errors.
  }
}
