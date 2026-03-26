/**
 * Supabase admin client for Edge Functions.
 * Uses service role key to bypass RLS for writing AI-generated data.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Extracts the authenticated user ID from the request's Authorization header.
 */
export async function getUserId(req: Request): Promise<string> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw new Error('Missing Authorization header');

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await createClient(
    supabaseUrl,
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  ).auth.getUser(token);

  if (error || !user) throw new Error('Invalid token');
  return user.id;
}
