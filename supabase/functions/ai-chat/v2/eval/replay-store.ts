/**
 * Replay cache (§9.1): `eval/.replay/<sha256>.json`, key = sha256 of the canonical request body
 * that was POSTed to ai-decide. CI replays recorded model outputs with no API key, so a replay
 * run is deterministic and free.
 *
 * One key holds an ARRAY of responses: a live run with N=5 records five answers to the same body
 * (/responses has no temperature/seed), and replay rep i reads responses[i]. That keeps the
 * per-rep variance — and therefore the "her tekrarda %100" B+ gate — reproducible offline.
 *
 * Stored bodies never include headers, so the service-role key can never land in the cache.
 */
import type { LlmResponse } from './transport.ts';

export interface ReplayEntry {
  key: string;
  recorded_at: string;
  fixture_ids: string[];
  responses: LlmResponse[];
}

export interface ReplayStore {
  get(key: string): Promise<ReplayEntry | null>;
  append(key: string, fixtureId: string, response: LlmResponse): Promise<void>;
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

/** Strip fields that must never be cached (raw provider blobs may echo request metadata). */
function sanitize(r: LlmResponse): LlmResponse {
  const { ok, status, error, text, decision, refusal, validation, commit, receipts, reply, envelope, facts, usage, latency_ms, model_served } = r;
  return { ok, status, error, text, decision, refusal, validation, commit, receipts, reply, envelope, facts, usage, latency_ms, model_served };
}

export function memoryReplayStore(seed: ReplayEntry[] = []): ReplayStore & { entries(): ReplayEntry[] } {
  const map = new Map<string, ReplayEntry>(seed.map((e) => [e.key, structuredClone(e)]));
  return {
    get: (key) => Promise.resolve(map.has(key) ? structuredClone(map.get(key)!) : null),
    append: (key, fixtureId, response) => {
      const e = map.get(key) ?? { key, recorded_at: new Date().toISOString(), fixture_ids: [], responses: [] };
      if (!e.fixture_ids.includes(fixtureId)) e.fixture_ids.push(fixtureId);
      e.responses.push(sanitize(response));
      map.set(key, e);
      return Promise.resolve();
    },
    entries: () => [...map.values()].map((e) => structuredClone(e)),
  };
}

/** File-backed store. Reads need --allow-read; appends (record mode) need --allow-write. */
export function fsReplayStore(dir: string): ReplayStore {
  let end = dir.length;
  while (end > 0 && (dir[end - 1] === '/' || dir[end - 1] === '\\')) end--;
  const base = dir.slice(0, end);
  const file = (key: string) => `${base}/${key}.json`;
  return {
    async get(key) {
      try {
        return JSON.parse(await Deno.readTextFile(file(key))) as ReplayEntry;
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) return null;
        throw new Error(`replay kaydı okunamadı (${key}): ${(err as Error).message}`);
      }
    },
    async append(key, fixtureId, response) {
      const cur = (await this.get(key)) ?? { key, recorded_at: new Date().toISOString(), fixture_ids: [], responses: [] };
      if (!cur.fixture_ids.includes(fixtureId)) cur.fixture_ids.push(fixtureId);
      cur.responses.push(sanitize(response));
      await Deno.mkdir(dir, { recursive: true });
      await Deno.writeTextFile(file(key), JSON.stringify(cur, null, 2) + '\n');
    },
  };
}
