/**
 * KOCHKO v2 eval runner — the documented entry point of docs/AI_MIMARI_V2.md §9.1.
 * Deno only (tsconfig excludes this file; `deno task v2-eval` from supabase/functions runs it too).
 * All logic lives in supabase/functions/ai-chat/v2/eval/; usage is in that folder's README.md.
 *
 *   npx deno run --config supabase/functions/deno.json --allow-read --allow-write --allow-net --allow-env scripts/eval-v2.ts --mode lint
 *
 * Keep `--config`: without it Deno resolves the repo-root package.json and rewrites the root deno.lock.
 */
import { main } from '../supabase/functions/ai-chat/v2/eval/cli.ts';

Deno.exit(await main(Deno.args));
