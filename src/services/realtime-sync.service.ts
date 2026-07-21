/**
 * Real-time Sync Service
 * Spec 14/16.4: Çoklu cihaz — oturum (session) yönetimi.
 *
 * NOTE (audit UX-OFF-05): The previous Supabase Realtime subscription /
 * forceSync / sync-state-machine / local conflict-resolver code paths were
 * never wired to any caller in app/ or src/ (the only real `resolveConflict`
 * in use lives in conflict-resolver.service.ts with a different signature).
 * That dead machinery was removed; this module now scopes the multi-device
 * claim to session management only (register / heartbeat / validity / list /
 * terminate), which IS actually consumed by app-init + account-security.
 */
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Session Management ───

/**
 * Register this device/app instance as an active session (Spec 16.4).
 * Returns the session id; caller stores locally to send heartbeats.
 * Safe to call repeatedly — reuses the same AsyncStorage-persisted id.
 */
const SESSION_ID_KEY = '@kochko_user_session_id';

export async function registerSession(deviceInfo: string, pushToken: string | null): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    // Reuse existing id if we already registered on this device
    const existingId = await AsyncStorage.getItem(SESSION_ID_KEY);
    if (existingId) {
      // FIX (audit UX-OFF-04): the row may have been pruned for inactivity
      // (30-day prune cron) even though the local id is still cached. Verify
      // the update actually hit a row; if not, fall through to a fresh insert
      // rather than silently keeping a dangling id that would later read as
      // "terminated by another device".
      const { data: updated } = await supabase.from('user_sessions').update({
        last_active_at: new Date().toISOString(),
        push_token: pushToken,
      }).eq('id', existingId).select('id').maybeSingle();
      if (updated) return existingId;
      await AsyncStorage.removeItem(SESSION_ID_KEY);
    }

    const { data, error } = await supabase.from('user_sessions').insert({
      user_id: user.id,
      device_info: deviceInfo,
      push_token: pushToken,
      last_active_at: new Date().toISOString(),
    }).select('id').single();

    if (error || !data) return null;
    await AsyncStorage.setItem(SESSION_ID_KEY, data.id as string);
    return data.id as string;
  } catch {
    return null;
  }
}

/**
 * Heartbeat: update last_active_at for this session. Call on app foreground.
 */
export async function heartbeatSession(): Promise<void> {
  try {
    const id = await AsyncStorage.getItem(SESSION_ID_KEY);
    if (!id) return;
    await supabase.from('user_sessions').update({
      last_active_at: new Date().toISOString(),
    }).eq('id', id);
  } catch {
    // best-effort
  }
}

/**
 * Result of a session liveness check.
 * - 'valid'      : our session row still exists; carry on.
 * - 'missing'    : the cached id no longer resolves. This is AMBIGUOUS — it can
 *                  mean another device terminated us OR the inactivity-prune
 *                  cron removed a stale row. The caller MUST NOT sign out on
 *                  this alone; it should clear + re-register a fresh session.
 * - 'unknown'    : transient/network error — treat as valid (do nothing).
 */
export type SessionLiveness = 'valid' | 'missing' | 'unknown';

/**
 * Check whether our session row still exists.
 *
 * FIX (audit UX-OFF-04): previously returned a bare boolean and the caller
 * signed the user out whenever it was false. But a row can vanish for two very
 * different reasons — an active remote termination from another device, OR the
 * 30-day inactivity prune cron deleting a stale row while the local
 * SESSION_ID_KEY is never cleared. Conflating them silently logged out anyone
 * who hadn't opened the app for 30+ days. We now report 'missing' as a distinct
 * state so the caller can re-register instead of signing out.
 */
export async function isSessionStillValid(): Promise<SessionLiveness> {
  try {
    const id = await AsyncStorage.getItem(SESSION_ID_KEY);
    if (!id) return 'valid'; // first run, will register
    const { data } = await supabase.from('user_sessions').select('id').eq('id', id).maybeSingle();
    return data ? 'valid' : 'missing';
  } catch {
    return 'unknown';
  }
}

/**
 * Recover from a 'missing' session: clear the stale cached id and register a
 * fresh row. Used when isSessionStillValid() reports 'missing' so an
 * inactivity-pruned user is silently re-registered rather than signed out.
 *
 * FIX (audit UX-OFF-04).
 */
export async function reregisterSession(deviceInfo: string, pushToken: string | null): Promise<string | null> {
  await AsyncStorage.removeItem(SESSION_ID_KEY);
  return registerSession(deviceInfo, pushToken);
}

/**
 * Get active sessions for the current user.
 */
export async function getActiveSessions(): Promise<{
  sessionId: string;
  deviceInfo: string;
  lastActiveAt: string;
}[]> {
  const { data } = await supabase
    .from('user_sessions')
    .select('id, device_info, last_active_at')
    .order('last_active_at', { ascending: false })
    .limit(10);

  return (data ?? []).map(s => ({
    sessionId: s.id as string,
    deviceInfo: s.device_info as string ?? 'Bilinmeyen cihaz',
    lastActiveAt: s.last_active_at as string,
  }));
}

/**
 * FIX (ux-audit device-fix): the id of THIS device's session (persisted at registration). The
 * settings list used to assume index 0 was the current device, but getActiveSessions orders by
 * last_active_at — so a more-recently-active OTHER device would be mislabelled "Mevcut" and this
 * device would show a "Kapat" that logs itself out. Compare against this id instead.
 */
export async function getCurrentSessionId(): Promise<string | null> {
  return AsyncStorage.getItem(SESSION_ID_KEY);
}

/**
 * Terminate a specific session by deleting its record.
 */
export async function terminateSession(sessionId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('user_sessions')
    .delete()
    .eq('id', sessionId);
  return { error: error?.message ?? null };
}
