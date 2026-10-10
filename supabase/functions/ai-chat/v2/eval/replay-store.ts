/**
 * Replay cache (§9.1): `eval/.replay/<sha256>.json`, key = sha256 of the canonical request body
 * that was POSTed to ai-decide. CI replays recorded model outputs with no API key, so a replay
 * run is deterministic and free.
 *
 * One key holds the answers of every rep, AT THEIR REP INDEX: a live run with N=5 records five
 * answers to the same body (/responses has no temperature/seed) and replay rep i reads
 * responses[i] — the answer rep i actually got. That keeps per-rep variance, and therefore the
 * "her tekrarda %100" B+ gate, reproducible offline. A rep whose call failed (infra) stays a hole
 * (null) and replays as a miss; the later reps do not shift into its place.
 *
 * Concurrency: the runner's pool runs reps of the same fixture side by side, so several writes to
 * one key are in flight at once. Every put is a read-modify-write, serialised PER KEY through a
 * promise chain (different keys still write in parallel), and the file is replaced atomically
 * (write to a temp file, then rename) so a crash never leaves half a JSON behind.
 *
 * Stored bodies never include headers, so the service-role key can never land in the cache.
 */
import type { LlmResponse } from './transport.ts';

export interface ReplayEntry {
  key: string;
  recorded_at: string;
  fixture_ids: string[];
  /** responses[rep]; null = that rep was never recorded (or its call failed). */
  responses: (LlmResponse | null)[];
}

export interface ReplayStore {
  get(key: string): Promise<ReplayEntry | null>;
  /** Store `response` as rep `rep`'s answer (replacing an earlier recording of that rep). */
  put(key: string, fixtureId: string, rep: number, response: LlmResponse): Promise<void>;
}

/** JSON with object keys sorted recursively — the hash must not depend on key insertion order. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalJson(x))).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function requestKey(payload: unknown): Promise<string> {
  return await sha256Hex(canonicalJson(payload));
}

/** Only the fields a replay needs; anything else a provider echoes is dropped. */
function sanitize(r: LlmResponse): LlmResponse {
  const { ok, status, kind, error, text, decision, refusal, issues, usage, latency_ms, model_served } = r;
  return JSON.parse(JSON.stringify({ ok, status, kind, error, text, decision, refusal, issues, usage, latency_ms, model_served }));
}

function withAnswer(cur: ReplayEntry | null, key: string, fixtureId: string, rep: number, response: LlmResponse, nowIso: string): ReplayEntry {
  if (!Number.isInteger(rep) || rep < 0) throw new Error(`geçersiz tekrar indeksi ${rep}`);
  const e: ReplayEntry = cur ?? { key, recorded_at: nowIso, fixture_ids: [], responses: [] };
  if (!e.fixture_ids.includes(fixtureId)) e.fixture_ids.push(fixtureId);
  while (e.responses.length <= rep) e.responses.push(null);
  e.responses[rep] = sanitize(response);
  e.recorded_at = nowIso;
  return e;
}

/** Per-key serialisation: each task for a key starts after the previous one settled. */
function keyedQueue() {
  const tails = new Map<string, Promise<void>>();
  return <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const prev = tails.get(key) ?? Promise.resolve();
    const run = prev.then(task, task);
    const tail = run.then(() => undefined, () => undefined);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };
}

export function memoryReplayStore(seed: ReplayEntry[] = []): ReplayStore & { entries(): ReplayEntry[] } {
  const map = new Map<string, ReplayEntry>(seed.map((e) => [e.key, structuredClone(e)]));
  return {
    get: (key) => Promise.resolve(map.has(key) ? structuredClone(map.get(key)!) : null),
    put: (key, fixtureId, rep, response) => {
      map.set(key, withAnswer(map.get(key) ?? null, key, fixtureId, rep, response, new Date().toISOString()));
      return Promise.resolve();
    },
    entries: () => [...map.values()].map((e) => structuredClone(e)),
  };
}

/** The file operations fsReplayStore needs — Deno's by default, injectable for tests. */
export interface ReplayFs {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  isNotFound(err: unknown): boolean;
}

export const denoReplayFs: ReplayFs = {
  readTextFile: (p) => Deno.readTextFile(p),
  writeTextFile: (p, d) => Deno.writeTextFile(p, d),
  rename: (a, b) => Deno.rename(a, b),
  mkdir: (p) => Deno.mkdir(p, { recursive: true }),
  isNotFound: (err) => err instanceof Deno.errors.NotFound,
};

/** File-backed store. Reads need --allow-read; puts (record mode) need --allow-write. */
export function fsReplayStore(dir: string, fs: ReplayFs = denoReplayFs): ReplayStore {
  let end = dir.length;
  while (end > 0 && (dir[end - 1] === '/' || dir[end - 1] === '\\')) end--;
  const base = dir.slice(0, end);
  const file = (key: string) => `${base}/${key}.json`;
  const queue = keyedQueue();
  let tmpSeq = 0;
  const read = async (key: string): Promise<ReplayEntry | null> => {
    try {
      return JSON.parse(await fs.readTextFile(file(key))) as ReplayEntry;
    } catch (err) {
      if (fs.isNotFound(err)) return null;
      throw new Error(`replay kaydı okunamadı (${key}): ${(err as Error).message}`);
    }
  };
  return {
    get: read,
    put(key, fixtureId, rep, response) {
      return queue(key, async () => {
        const next = withAnswer(await read(key), key, fixtureId, rep, response, new Date().toISOString());
        await fs.mkdir(base);
        const tmp = `${file(key)}.${++tmpSeq}.tmp`;
        await fs.writeTextFile(tmp, JSON.stringify(next, null, 2) + '\n');
        await fs.rename(tmp, file(key));
      });
    },
  };
}
