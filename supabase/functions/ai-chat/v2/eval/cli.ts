/**
 * `deno task v2-eval` / `scripts/eval-v2.ts` — command-line front of the eval runner.
 * Usage and examples: README.md in this folder (Turkish).
 *
 * Kips: lint | replay | live | judge | captures. The service-role key is read from a file and
 * handed straight to the transport closure; it is never printed, logged, cached or reported.
 */
import { loadFixtureDir } from './fixtures.ts';
import { runEval } from './runner.ts';
import { formatReport } from './report.ts';
import { gatesFailed } from './gates.ts';
import { endpointTransport, type LlmTransport, recordingTransport, replayTransport } from './transport.ts';
import { fsReplayStore } from './replay-store.ts';
import { DEFAULT_JUDGE_MODEL, transportJudge } from './judge.ts';
import type { Effort, RequestBuilder, StageAInputs, StrictSchema } from './request.ts';
import type { PostProcessPort } from './runner.ts';
import { captureToFixture, loadCaptures, opDiff } from './capture.ts';
import { PACKAGE_IDS, type PackageId } from './types.ts';

export interface Io { log(s: string): void; err(s: string): void }
const consoleIo: Io = { log: (s) => console.log(s), err: (s) => console.error(s) };

const FLAGS = new Set(['record', 'enforce-gates', 'verbose', 'live', 'help', 'allow-miss']);
export const MODES = ['lint', 'replay', 'live', 'judge', 'captures'] as const;
export type Mode = typeof MODES[number];

export function parseArgs(argv: string[]): { opts: Record<string, string | boolean>; errors: string[] } {
  const opts: Record<string, string | boolean> = {};
  const errors: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      errors.push(`beklenmeyen argüman "${a}"`);
      continue;
    }
    const eq = a.indexOf('=');
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (FLAGS.has(name)) {
      opts[name] = eq > 0 ? a.slice(eq + 1) !== 'false' : true;
      continue;
    }
    const v = eq > 0 ? a.slice(eq + 1) : argv[++i];
    if (v === undefined) errors.push(`--${name} bir değer ister`);
    else opts[name] = v;
  }
  const mode = String(opts.mode ?? 'lint');
  if (!(MODES as readonly string[]).includes(mode)) errors.push(`geçersiz --mode "${mode}" (${MODES.join(' | ')})`);
  return { opts, errors };
}

// ── paths (no std/path import: keep the module dependency-free) ────────────────────────────────

const isAbs = (p: string) => p.startsWith('/') || p.startsWith('\\') || (p.length > 2 && p[1] === ':');
function baseDir(): string {
  try {
    return Deno.env.get('INIT_CWD') ?? Deno.cwd(); // deno task runs in the config dir; INIT_CWD is the caller's
  } catch {
    return Deno.cwd();
  }
}
export const resolveUserPath = (p: string) => (isAbs(p) ? p : `${baseDir()}/${p}`);
export function urlToPath(u: URL): string {
  let p = decodeURIComponent(u.pathname);
  if (p.length > 2 && p[0] === '/' && p[2] === ':') p = p.slice(1);
  return p;
}
function fileUrl(abs: string): string {
  const s = abs.split('\\').join('/');
  return new URL(s.startsWith('/') ? `file://${s}` : `file:///${s}`).href;
}

/** `file.json` | `file.txt` | `module.ts#export` (a value or a zero-arg function). */
export async function loadInput(spec: string): Promise<unknown> {
  const hash = spec.lastIndexOf('#');
  const file = hash > 1 ? spec.slice(0, hash) : spec;
  const exportName = hash > 1 ? spec.slice(hash + 1) : 'default';
  const abs = resolveUserPath(file);
  if (file.endsWith('.ts') || file.endsWith('.js') || file.endsWith('.mjs')) {
    const mod = await import(fileUrl(abs)) as Record<string, unknown>;
    const v = mod[exportName];
    if (v === undefined) throw new Error(`${file} içinde "${exportName}" export'u yok`);
    return typeof v === 'function' ? await (v as () => unknown)() : v;
  }
  const text = await Deno.readTextFile(abs);
  return file.endsWith('.json') ? JSON.parse(text) : text;
}

export function toStrictSchema(v: unknown, fallbackName = 'kochko_understand_eval'): StrictSchema {
  if (!v || typeof v !== 'object') throw new Error('şema bir JSON nesnesi olmalı');
  const o = v as Record<string, unknown>;
  if (o.schema && typeof o.schema === 'object') {
    return { name: String(o.name ?? fallbackName), schema: o.schema as Record<string, unknown>, strict: o.strict !== false };
  }
  return { name: fallbackName, schema: o, strict: true };
}

async function findKeyFile(explicit?: string): Promise<string | null> {
  const cands: string[] = [];
  if (explicit) cands.push(resolveUserPath(explicit));
  try {
    const env = Deno.env.get('KOCHKO_SERVICE_ROLE_KEY_FILE');
    if (env) cands.push(env);
  } catch { /* no env permission */ }
  // Walk up from the caller's cwd: works from the repo root, supabase/functions and worktrees.
  let dir = baseDir().split('\\').join('/');
  for (let i = 0; i < 8 && dir; i++) {
    cands.push(`${dir}/TEMP/service_role.key`);
    const cut = dir.lastIndexOf('/');
    if (cut <= 0) break;
    dir = dir.slice(0, cut);
  }
  for (const c of cands) {
    try {
      if ((await Deno.stat(c)).isFile) return c;
    } catch { /* keep looking */ }
  }
  return null;
}

function endpointUrl(explicit?: string): string {
  if (explicit) return explicit;
  try {
    const env = Deno.env.get('KOCHKO_AI_DECIDE_URL');
    if (env) return env;
    const ref = Deno.env.get('KOCHKO_PROJECT_REF') ?? 'ugoynltxwrkqjwrdxmzt';
    return `https://${ref}.supabase.co/functions/v1/ai-decide`;
  } catch {
    return 'https://ugoynltxwrkqjwrdxmzt.supabase.co/functions/v1/ai-decide';
  }
}

async function liveTransport(opts: Record<string, string | boolean>, io: Io): Promise<LlmTransport | null> {
  const keyFile = await findKeyFile(opts['key-file'] as string | undefined);
  if (!keyFile) {
    io.err('service_role anahtar dosyası bulunamadı (TEMP/service_role.key, --key-file ya da KOCHKO_SERVICE_ROLE_KEY_FILE).');
    return null;
  }
  const key = (await Deno.readTextFile(keyFile)).trim();
  if (!key) {
    io.err('service_role anahtar dosyası boş.');
    return null;
  }
  return endpointTransport({ url: endpointUrl(opts.endpoint as string | undefined), key, timeoutMs: Number(opts['timeout-ms'] ?? 90_000) });
}

const HELP = `KOCHKO v2 eval (AI_MIMARI_V2 §9) — ayrıntı: supabase/functions/ai-chat/v2/eval/README.md
  --mode lint|replay|live|judge|captures   (varsayılan lint)
  --schema <json|ts#export>  --system <txt|ts#export>   (lint dışı kiplerde zorunlu)
  --model gpt-5.6-terra  --effort auto|low|medium|none  --reps N  --concurrency 4
  --filter <metin>  --package A,A',B+,B-,C,D,E  --out rapor.json  --verbose
  --record (live/judge: cevapları .replay/'e yazar)  --enforce-gates  --allow-miss
  --payload raw|turn  --builder-module <ts#export>  --post-module <ts#export>  --aliases <json>
  --endpoint <url>  --key-file <dosya>  --judge-model gpt-6-luna  --captures <klasör>`;

export async function main(argv: string[], io: Io = consoleIo): Promise<number> {
  const { opts, errors } = parseArgs(argv);
  if (opts.help) {
    io.log(HELP);
    return 0;
  }
  if (errors.length) {
    io.err(errors.join('\n'));
    io.err(HELP);
    return 2;
  }
  const mode = String(opts.mode ?? 'lint') as Mode;
  const fixturesDir = opts.fixtures ? resolveUserPath(String(opts.fixtures)) : urlToPath(new URL('./fixtures/', import.meta.url));
  const replayDir = opts['replay-dir'] ? resolveUserPath(String(opts['replay-dir'])) : urlToPath(new URL('./.replay/', import.meta.url));

  const loaded = await loadFixtureDir(fixturesDir);
  if (loaded.issues.length) {
    io.err(`Fixture lint: ${loaded.issues.length} sorun`);
    for (const i of loaded.issues.slice(0, 50)) io.err(`  ${i.file} · ${i.fixture}: ${i.message}`);
    return 1;
  }
  let fixtures = loaded.fixtures;
  if (opts.filter) {
    const f = String(opts.filter).toLocaleLowerCase('tr');
    fixtures = fixtures.filter((x) => x.id.includes(f) || x.source.toLocaleLowerCase('tr').includes(f) || (x.tags ?? []).includes(f));
  }
  if (opts.package) {
    const want = String(opts.package).split(',').map((s) => s.trim()) as PackageId[];
    const bad = want.filter((p) => !PACKAGE_IDS.includes(p));
    if (bad.length) {
      io.err(`geçersiz paket: ${bad.join(', ')}`);
      return 2;
    }
    fixtures = fixtures.filter((x) => want.includes(x.package));
  }

  if (mode === 'lint') {
    const by = (k: (f: typeof fixtures[number]) => string) => {
      const m = new Map<string, number>();
      for (const f of fixtures) m.set(k(f), (m.get(k(f)) ?? 0) + 1);
      return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([a, n]) => `${a}:${n}`).join('  ');
    };
    io.log(`Fixture lint temiz: ${fixtures.length} fixture, ${loaded.files.length} dosya, ${Object.keys(loaded.personas).length} persona`);
    io.log(`  paket   ${by((f) => f.package)}`);
    io.log(`  hat     ${by((f) => f.pipeline ?? 'chat')}`);
    io.log(`  kaynak  ${by((f) => f.source.split('#')[0].split(':')[0])}`);
    return 0;
  }

  if (!opts.schema || !opts.system) {
    if (opts.payload !== 'turn') {
      io.err('Bu kip --schema ve --system ister (registry gelene kadar şema ve Stage A prompt\'u girdi olarak verilir). Sunucu prompt\'u kendisi kuruyorsa --payload turn kullan.');
      return 2;
    }
  }
  const inputs: StageAInputs = {
    system_prompt: opts.system ? String(await loadInput(String(opts.system))) : '',
    schema: opts.schema ? toStrictSchema(await loadInput(String(opts.schema)), opts['schema-name'] as string | undefined) : { name: 'server_side', schema: {}, strict: true },
    model: String(opts.model ?? 'gpt-5.6-terra'),
    effort: String(opts.effort ?? 'auto') as Effort,
    max_output_tokens: opts['max-output-tokens'] ? Number(opts['max-output-tokens']) : undefined,
  };
  if (!['auto', 'none', 'low', 'medium', 'high'].includes(inputs.effort)) {
    io.err(`geçersiz --effort "${inputs.effort}"`);
    return 2;
  }
  const buildRequest = opts['builder-module'] ? (await loadInput(String(opts['builder-module'])) as RequestBuilder) : undefined;
  const postprocess = opts['post-module'] ? (await loadInput(String(opts['post-module'])) as PostProcessPort) : undefined;
  const aliases = opts.aliases ? (await loadInput(String(opts.aliases)) as Record<string, string>) : undefined;
  const store = fsReplayStore(replayDir);

  let transport: LlmTransport;
  if (mode === 'replay' || (mode === 'captures' && !opts.live)) transport = replayTransport(store);
  else {
    const live = await liveTransport(opts, io);
    if (!live) return 2;
    transport = opts.record ? recordingTransport(live, store) : live;
  }

  if (mode === 'captures') {
    if (!opts.captures) {
      io.err('--captures <klasör> gerekli');
      return 2;
    }
    const { captures, refused } = await loadCaptures(resolveUserPath(String(opts.captures)));
    for (const r of refused) io.err(`reddedildi ${r.file}: ${r.reason}`);
    const capFixtures = captures.map((c) => captureToFixture(c, [{ path: 'decision', exists: true }]));
    const rep = await runEval({ fixtures: capFixtures, reps: 1, inputs, transport, mode, buildRequest, payloadMode: opts.payload === 'turn' ? 'turn' : 'raw', concurrency: Number(opts.concurrency ?? 4), keepDecisions: true });
    for (const [i, r] of rep.results.entries()) {
      const d = opDiff(captures[i].v1_actions, r.decision);
      io.log(`${r.fixture_id}: ${r.status}${r.skip_reason ? ` (${r.skip_reason})` : ''} · yalnız v1 [${d.only_v1.join(',')}] · yalnız v2 [${d.only_v2.join(',')}] · ortak [${d.both.join(',')}]`);
    }
    return 0;
  }

  // §9.1: live runs are N=5 (no temperature/seed on /responses); replay reads the same 5 answers.
  const reps = Number(opts.reps ?? 5);
  const rep = await runEval({
    fixtures,
    reps,
    inputs,
    transport,
    mode,
    buildRequest,
    payloadMode: opts.payload === 'turn' ? 'turn' : 'raw',
    aliases,
    postprocess,
    judge: mode === 'judge' ? transportJudge(transport, String(opts['judge-model'] ?? DEFAULT_JUDGE_MODEL)) : undefined,
    concurrency: Number(opts.concurrency ?? 4),
    keepDecisions: !!opts.out,
  });
  io.log(formatReport(rep, { verbose: !!opts.verbose }));
  if (opts.out) {
    const out = resolveUserPath(String(opts.out));
    await Deno.writeTextFile(out, JSON.stringify(rep, null, 2) + '\n');
    io.log(`JSON rapor: ${out}`);
  }
  if (opts['enforce-gates']) {
    const failed = gatesFailed(rep).filter((g) => !(opts['allow-miss'] && g.status === 'incomplete'));
    if (failed.length) {
      io.err(`Kapı başarısız: ${failed.map((g) => `${g.package} (${g.status})`).join(', ')}`);
      return 1;
    }
  }
  return 0;
}

if (import.meta.main) Deno.exit(await main(Deno.args));
