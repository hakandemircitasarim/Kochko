import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/**
 * The admin client is created at module load, so importing ANY shared module used to throw
 * "supabaseUrl is required" outside the edge runtime — which made every pure helper living next to
 * a DB call untestable. The repo's answer had been to not test them, and that is how
 * `[object Object]`, `undefinedkg` and a wholesale coaching_notes wipe all reached production
 * without a single failing test.
 *
 * Placeholders keep construction total (no throw at import) while preserving the exact inferred
 * type and every call site. In the edge runtime both variables are always present, so this changes
 * nothing there; in a unit test the client is simply never queried.
 */
const MISSING_ENV = !supabaseUrl || !supabaseServiceKey;
if (MISSING_ENV && Deno.env.get('DENO_TESTING') !== '1') {
  console.warn('[supabase-admin] SUPABASE_URL / SERVICE_ROLE_KEY missing — queries will fail');
}
export const supabaseAdmin = createClient(
  supabaseUrl || 'http://127.0.0.1:54321',
  supabaseServiceKey || 'missing-service-role-key',
);

export async function getUserId(req: Request): Promise<string> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw new Error('Missing Authorization header');

  const token = authHeader.replace('Bearer ', '');

  // Internal service-to-service calls (ai-proactive → ai-report): the caller
  // authenticates with the service-role key itself and names the target user
  // via x-user-id. A user JWT can never take this path — it would have to
  // EQUAL the service-role key. Without this, the nightly auto-report trigger
  // always failed auth (a service key is not a user JWT).
  const serviceUserId = req.headers.get('x-user-id');
  if (serviceUserId && supabaseServiceKey && token === supabaseServiceKey) {
    return serviceUserId;
  }

  const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '');
  const { data: { user }, error } = await anonClient.auth.getUser(token);

  if (error || !user) throw new Error('Invalid token');
  return user.id;
}
