/**
 * Stage A request building for the eval runner.
 *
 * BEFORE the write registry lands, the runner cannot import the real schema / understand prompt,
 * so both are INPUTS (--schema, --system). `provisionalRequestBuilder` renders the fixture's
 * TurnInput into a Turkish block in the §4.2 order and wraps it in a Responses API body with
 * strict json_schema. At integration the real `buildRequest` from ai-chat/v2/understand.ts is
 * plugged in through `RequestBuilder` (cli: --builder-module), and nothing else changes.
 *
 * Determinism matters: the replay key is the sha256 of this body, so rendering must be a pure
 * function of (fixture, inputs) — no clocks, no randomness, stable ordering.
 */
import type { EvalFixture, FixtureTurnInput } from './types.ts';

export interface StrictSchema { name: string; schema: Record<string, unknown>; strict: boolean }
export type Effort = 'auto' | 'none' | 'low' | 'medium' | 'high';

export interface StageAInputs {
  system_prompt: string;
  schema: StrictSchema;
  model: string;
  effort: Effort;
  max_output_tokens?: number;
  /** Stage A prefix is byte-identical for every user → one global cache key (§3.2 T4). */
  cache_key?: string;
}

export type RequestBuilder = (fixture: EvalFixture, inputs: StageAInputs) => Record<string, unknown> | Promise<Record<string, unknown>>;

/** §8.4: Stage A is `low`, `medium` only on facts code knows for certain. Never `none` unless asked. */
export function effortFor(ti: FixtureTurnInput): 'low' | 'medium' {
  const tierUp = ti.tier === 'watch' || ti.tier === 'amber' || ti.tier === 'red';
  return ti.image || !!ti.draft || (ti.tripwires?.length ?? 0) > 0 || tierUp ? 'medium' : 'low';
}

export function resolveEffort(e: Effort, ti: FixtureTurnInput): Exclude<Effort, 'auto'> {
  return e === 'auto' ? effortFor(ti) : e;
}

const val = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));

/** The TurnInput block Stage A reads (provisional renderer; input.ts replaces it). */
export function renderTurnInputBlock(ti: FixtureTurnInput): string {
  const L: string[] = [];
  const now = ti.now;
  if (now) L.push(`ŞİMDİ: ${now.local_date}${now.weekday_tr ? ` ${now.weekday_tr}` : ''}${now.local_time ? ` ${now.local_time}` : ''}${now.tz ? ` (${now.tz})` : ''}`);
  L.push(`YB SEVİYESİ: ${ti.tier ?? 'none'}`);
  const prof = Object.entries(ti.profile ?? {});
  if (prof.length) L.push(`PROFİL: ${prof.map(([k, v]) => `${k}=${val(v)}`).join(' · ')}`);
  if (ti.spine?.length) {
    L.push('KISITLAR (omurga):');
    for (const c of ti.spine) {
      const bits = [c.kind, c.display_tr, c.severity ?? 'unknown', c.whose ?? 'self', c.active === false ? 'PASİF (geri alındı)' : 'aktif'];
      if (c.body_parts?.length) bits.push(`bölge: ${c.body_parts.join(',')}`);
      if (c.note) bits.push(`not: "${c.note}"`);
      L.push(`${c.ref} · ${bits.join(' · ')}`);
    }
  }
  if (ti.records?.length) {
    L.push('KAYITLAR (son 7 gün, ref ile):');
    for (const r of ti.records) L.push(`${r.ref} · ${r.line}${r.last_turn ? ' (son tur)' : ''}`);
  }
  const today = Object.entries(ti.today ?? {});
  if (today.length) L.push(`BUGÜN: ${today.map(([k, v]) => `${k}=${val(v)}`).join(' · ')}`);
  if (ti.pending?.length) {
    L.push('BEKLEYEN ONAYLAR:');
    for (const p of ti.pending) L.push(`${p.ref} · ${p.op} · ${p.line}`);
  }
  if (ti.commitments?.length) {
    L.push('AÇIK SÖZLER:');
    for (const k of ti.commitments) L.push(`${k.ref} · ${k.line}`);
  }
  if (ti.draft) L.push(`PLAN TASLAĞI: ${ti.draft.ref} · ${ti.draft.plan_type} v${ti.draft.version} · ${ti.draft.line}`);
  if (ti.gates?.length) L.push(`YAZMA KAPILARI: ${ti.gates.join(' · ')}`);
  if (ti.reference_candidates?.length) {
    L.push('REFERANS ADAYLARI (yalnızca ipucu, kod dayatmaz):');
    for (const c of ti.reference_candidates) L.push(`${c.key}: ${c.line}`);
  }
  if (ti.image) L.push('GÖRSEL: kullanıcı bir fotoğraf ekledi.');
  if (ti.tripwires?.length) {
    L.push('TETİKLER (kod buldu, anlamını sen oku):');
    for (const t of ti.tripwires) L.push(`${t.id} · ${t.list} · ${t.category} · "${t.match}"`);
  }
  if (ti.history?.length) {
    L.push('SON KONUŞMA:');
    for (const h of ti.history) {
      L.push(`${h.role === 'user' ? 'kullanıcı' : 'koç'}: ${h.content}`);
      for (const rc of h.receipts ?? []) L.push(`  ⟦${rc}⟧`);
    }
  }
  return L.join('\n');
}

export function stageAUserContent(fixture: EvalFixture): string {
  return `${renderTurnInputBlock(fixture.turn_input)}\n\nKULLANICI MESAJI:\n${fixture.message}`;
}

/** Responses API body with strict json_schema (§3.2 T4). `store:false` explicitly (§10 Faz 1). */
export const provisionalRequestBuilder: RequestBuilder = (fixture, inputs) => {
  const body: Record<string, unknown> = {
    model: inputs.model,
    store: false,
    input: [
      { role: 'system', content: inputs.system_prompt },
      { role: 'user', content: stageAUserContent(fixture) },
    ],
    text: { format: { type: 'json_schema', name: inputs.schema.name, schema: inputs.schema.schema, strict: inputs.schema.strict } },
    prompt_cache_key: inputs.cache_key ?? `kochko-understand:${inputs.schema.name}`,
    max_output_tokens: inputs.max_output_tokens ?? 4000,
  };
  const effort = resolveEffort(inputs.effort, fixture.turn_input);
  body.reasoning = { effort };
  return body;
};

/** What is POSTed to ai-decide (and hashed for the replay key). */
export function rawPayload(request: Record<string, unknown>): Record<string, unknown> {
  return { mode: 'raw', request };
}

/** Post-registry form: ai-decide builds the prompt itself from the TurnInput. */
export function turnPayload(fixture: EvalFixture, inputs: StageAInputs): Record<string, unknown> {
  return {
    mode: 'turn',
    turn_input: fixture.turn_input,
    message: fixture.message,
    client: fixture.client ?? null,
    model: inputs.model,
    effort: resolveEffort(inputs.effort, fixture.turn_input),
  };
}
