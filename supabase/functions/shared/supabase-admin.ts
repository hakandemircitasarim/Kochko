import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

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
