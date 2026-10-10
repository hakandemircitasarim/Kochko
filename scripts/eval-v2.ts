/**
 * KOCHKO v2 eval runner — the documented entry point of docs/AI_MIMARI_V2.md §9.1.
 * Deno only (tsconfig excludes this file; `deno task v2-eval` from supabase/functions runs it too).
 * All logic lives in supabase/functions/ai-chat/v2/eval/; usage is in that folder's README.md.
 *
 *   npx deno task --config supabase/functions/deno.json v2-eval --mode lint
 *   npx deno task --config supabase/functions/deno.json v2-eval-live --dry-run   (pre-flight, no call)
 *   npx deno task --config supabase/functions/deno.json v2-eval-live             (the full live run, N=5, records .replay/)
 *
 * Keep `--config` and `--no-lock` (the tasks pass it): otherwise Deno resolves the repo-root
 * package.json and rewrites the root deno.lock.
 */
import { main } from '../supabase/functions/ai-chat/v2/eval/cli.ts';

Deno.exit(await main(Deno.args));
