/**
 * Cron-only guard for the fleet-processing edge functions (ai-proactive,
 * ai-extractor, cleanup-scheduled). These run with verify_jwt=false and process
 * the WHOLE user fleet (LLM calls + push). Without a guard, anyone holding the
 * public anon key could POST and trigger fleet-wide cost / abuse.
 *
 * The pg_cron jobs pass `x-cron-secret: <CRON_SECRET>`. We reject any
 * request whose header doesn't match the configured secret.
 *
 * FAIL-OPEN when CRON_SECRET is unset: a missing env var must never lock
 * out the crons. Once the secret is configured (and the cron commands send the
 * header), the guard is effectively fail-closed for everyone else.
 */
export function denyIfNotCron(req: Request): Response | null {
  const expected = Deno.env.get('CRON_SECRET');
  if (!expected) return null; // not configured → allow (fail open)
  const got = req.headers.get('x-cron-secret');
  if (got === expected) return null;
  return new Response(JSON.stringify({ error: 'forbidden' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
