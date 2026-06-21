/**
 * Cron-only guard for the fleet-processing edge functions (ai-proactive,
 * ai-extractor, cleanup-scheduled). These run with verify_jwt=false and process
 * the WHOLE user fleet (LLM calls + push). Without a guard, anyone holding the
 * public anon key could POST and trigger fleet-wide cost / abuse.
 *
 * The pg_cron jobs pass `x-cron-secret: <CRON_SECRET>` AND
 * `Authorization: Bearer <service_role_key>`. We accept either proof.
 *
 * FIX (audit AI-PRO-04/HIGH): NO fail-open. The old code returned null (allow)
 * whenever CRON_SECRET was unset — so in any deploy that forgot to set the env
 * var, ANYONE holding the public anon key could POST and trigger fleet-wide
 * LLM/push cost & abuse. We now also reject when the secret is unconfigured,
 * EXCEPT for a caller presenting the SECRET service-role key as bearer (exactly
 * what pg_cron sends). The anon key shipped in the app does NOT match the
 * service-role key, so fleet abuse stays blocked even with CRON_SECRET unset —
 * and the crons keep working with zero extra configuration.
 */
export function denyIfNotCron(req: Request): Response | null {
  // Preferred proof: matching cron secret header (when configured).
  const expected = Deno.env.get('CRON_SECRET');
  const got = req.headers.get('x-cron-secret');
  if (expected && got === expected) return null;

  // Fallback proof (fail-CLOSED): the server-only service-role key as bearer.
  // pg_cron sends `Authorization: Bearer <service_role_key>`; the public anon
  // key never matches, so this rejects external callers without locking out crons.
  const srk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const auth = req.headers.get('Authorization');
  if (srk && auth === `Bearer ${srk}`) return null;

  return new Response(JSON.stringify({ error: 'forbidden' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * FIX (audit cron-secret): build the headers for an INTERNAL service-to-service
 * call from a cron function (e.g. ai-proactive → ai-report). Mirrors the
 * pg_cron→edge contract: service-role bearer + x-cron-secret. When CRON_SECRET
 * is unset the x-cron-secret header is omitted entirely, so a missing env var
 * stays fail-open (matches denyIfNotCron above) rather than sending a stale/empty
 * secret. `extra` lets callers add per-call headers (e.g. x-user-id).
 */
export function cronHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`,
    ...extra,
  };
  const secret = Deno.env.get('CRON_SECRET');
  if (secret) headers['x-cron-secret'] = secret;
  return headers;
}
