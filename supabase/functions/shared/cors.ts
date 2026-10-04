/**
 * CORS for client-invoked edge functions.
 *
 * ai-report and ai-plan never answered the browser preflight (OPTIONS) and sent no CORS headers, so
 * on Expo web the reports and weekly-menu calls failed before reaching the function. Native builds
 * don't preflight, which is why it went unnoticed. The allowed headers include the two the client
 * attaches to every invocation (src/lib/edgeHeaders.ts).
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-version, x-region',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Wrap a serve() handler: answer OPTIONS, and add the CORS headers to whatever it returns. */
export function withCors(handler: (req: Request) => Promise<Response> | Response) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    const res = await handler(req);
    try {
      for (const [k, v] of Object.entries(corsHeaders)) res.headers.set(k, v);
      return res;
    } catch {
      // Immutable headers (e.g. a proxied Response): rebuild with the CORS set merged in.
      const h = new Headers(res.headers);
      for (const [k, v] of Object.entries(corsHeaders)) h.set(k, v);
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    }
  };
}
