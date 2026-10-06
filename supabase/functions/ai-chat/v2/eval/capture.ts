/**
 * Captured TurnInputs — the FORMAT a production/shadow capture must have so the runner can replay
 * it through Stage A (§9.3 "Gölge farkları", §10 Faz 2). The writer lands with migration 109 and
 * the shadow job; only the format, its checks and the conversion live here today.
 *
 * Health data rules (owner decision 2026-10-06, §11 risk 10): test accounts, or consented AND
 * redacted; kept at most 30 days. An expired capture is refused, never silently replayed.
 */
import type { EvalFixture, FixtureTurnInput, Json, PackageId } from './types.ts';
import { PACKAGE_IDS } from './types.ts';

export const CAPTURE_FORMAT = 'kochko-captured-turn/v1';
export const CAPTURE_RETENTION_DAYS = 30;

export interface CapturedTurn {
  format: typeof CAPTURE_FORMAT;
  capture_id: string; // opaque, never a user uuid
  captured_at: string; // ISO
  expires_at: string; // ≤ captured_at + 30 days
  account_class: 'test' | 'consented_redacted';
  pipeline: 'v1' | 'v2_shadow' | 'v2';
  schema_version?: string | null;
  /** The serialized TurnInput exactly as Stage A saw it (refs already short tokens). */
  turn_input: FixtureTurnInput;
  message: string;
  /** What v1 executed this turn (shadow diff), legacy action types. */
  v1_actions?: { type: string; [k: string]: Json }[];
  /** Stage A decision recorded in shadow, if any. */
  v2_decision?: Json;
  labels?: { package?: PackageId; disagreement_class?: string; note?: string };
}

const DAY_MS = 86_400_000;

export function validateCapture(c: unknown): string[] {
  const out: string[] = [];
  if (!c || typeof c !== 'object') return ['kayıt nesne değil'];
  const o = c as Record<string, unknown>;
  if (o.format !== CAPTURE_FORMAT) out.push(`format "${CAPTURE_FORMAT}" olmalı`);
  if (typeof o.capture_id !== 'string' || !o.capture_id) out.push('capture_id eksik');
  const at = Date.parse(String(o.captured_at));
  const exp = Date.parse(String(o.expires_at));
  if (Number.isNaN(at)) out.push('captured_at ISO tarih olmalı');
  if (Number.isNaN(exp)) out.push('expires_at ISO tarih olmalı');
  if (!Number.isNaN(at) && !Number.isNaN(exp) && exp - at > CAPTURE_RETENTION_DAYS * DAY_MS) out.push('saklama 30 günü aşıyor');
  if (o.account_class !== 'test' && o.account_class !== 'consented_redacted') out.push('account_class test | consented_redacted olmalı');
  if (!['v1', 'v2_shadow', 'v2'].includes(String(o.pipeline))) out.push('pipeline v1 | v2_shadow | v2 olmalı');
  if (!o.turn_input || typeof o.turn_input !== 'object') out.push('turn_input eksik');
  if (typeof o.message !== 'string' || !o.message.trim()) out.push('message eksik');
  const pkg = (o.labels as Record<string, unknown> | undefined)?.package;
  if (pkg !== undefined && !PACKAGE_IDS.includes(pkg as PackageId)) out.push(`geçersiz labels.package "${pkg}"`);
  return out;
}

export function isExpired(c: CapturedTurn, now: Date): boolean {
  return Date.parse(c.expires_at) <= now.getTime();
}

/** Triage helper: a capture becomes a candidate fixture. Expectations are written by a human
 *  (or derived from the disagreement class) — a capture alone never asserts anything. */
export function captureToFixture(c: CapturedTurn, expect: EvalFixture['expect'] = []): EvalFixture {
  return {
    id: `cap-${c.capture_id.toLowerCase().split('').filter((ch) => (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch === '-').join('')}`,
    source: `capture:${c.capture_id}`,
    package: c.labels?.package ?? 'A',
    title: c.labels?.note ?? `Yakalanan tur (${c.labels?.disagreement_class ?? 'sınıflanmadı'})`,
    pipeline: 'chat',
    turn_input: c.turn_input,
    message: c.message,
    expect,
  };
}

/** v1 legacy action type → v2 op (§4.1 envelope names, reversed). */
const V1_TO_V2: Record<string, string> = {
  meal_log: 'meal_log', water_log: 'water_log', weight_log: 'body_weight', workout_log: 'workout_log',
  sleep_log: 'sleep_log', mood_log: 'mood_log', step_log: 'step_log', supplement_log: 'supplement_log',
  profile_update: 'profile_set', undo: 'record_ops', goal_update: 'goal_set', goal_suggestion: 'goal_set',
};

/** Op-set diff between what v1 executed and what Stage A decided — the shadow-diff class key. */
export function opDiff(v1Actions: { type: string }[] | undefined, decision: unknown): { only_v1: string[]; only_v2: string[]; both: string[] } {
  const v1 = new Set((v1Actions ?? []).map((a) => V1_TO_V2[a.type] ?? a.type));
  const v2 = new Set<string>();
  const d = (decision && typeof decision === 'object' ? decision : {}) as Record<string, unknown>;
  for (const w of (Array.isArray(d.writes) ? d.writes : []) as Record<string, unknown>[]) if (typeof w?.op === 'string') v2.add(w.op);
  if (Array.isArray(d.record_ops) && d.record_ops.length) v2.add('record_ops');
  const all = [...new Set([...v1, ...v2])].sort();
  return { only_v1: all.filter((x) => v1.has(x) && !v2.has(x)), only_v2: all.filter((x) => v2.has(x) && !v1.has(x)), both: all.filter((x) => v1.has(x) && v2.has(x)) };
}

/** Read *.json captures from a directory, refusing malformed and expired ones. */
export async function loadCaptures(dir: string, now = new Date()): Promise<{ captures: CapturedTurn[]; refused: { file: string; reason: string }[] }> {
  const captures: CapturedTurn[] = [];
  const refused: { file: string; reason: string }[] = [];
  const names: string[] = [];
  for await (const e of Deno.readDir(dir)) if (e.isFile && e.name.endsWith('.json')) names.push(e.name);
  for (const n of names.sort()) {
    try {
      const c = JSON.parse(await Deno.readTextFile(`${dir}/${n}`));
      const errs = validateCapture(c);
      if (errs.length) refused.push({ file: n, reason: errs.join('; ') });
      else if (isExpired(c as CapturedTurn, now)) refused.push({ file: n, reason: 'süresi dolmuş (30 gün) — silinmeli' });
      else captures.push(c as CapturedTurn);
    } catch (err) {
      refused.push({ file: n, reason: `okunamadı: ${(err as Error).message}` });
    }
  }
  return { captures, refused };
}
