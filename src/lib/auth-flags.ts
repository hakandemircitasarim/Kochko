/**
 * Social-auth provider flags — ONE owner (launch inventory, 2026-07-29).
 *
 * Google/Apple providers are NOT configured in Supabase Auth (they need Google Cloud /
 * Apple Developer client credentials — owner action). The dead "Bağla" button used to drop
 * users on a broken OAuth page. login.tsx and register.tsx each carried their own copy of
 * this flag while account-security.tsx was forgotten and kept its live dead button — the
 * classic drift this module ends.
 *
 * To activate: create the OAuth client → enter ID+secret in Supabase Auth → flip the flag.
 */
export const GOOGLE_LOGIN_ENABLED = false;

/**
 * Apple sign-in: the iOS buttons render today, but the provider is unverified in Supabase.
 * Kept as a flag so account-security can badge it "Yakında" on iOS until it is confirmed.
 * (Android never shows Apple rows.)
 */
export const APPLE_LOGIN_ENABLED = false;
