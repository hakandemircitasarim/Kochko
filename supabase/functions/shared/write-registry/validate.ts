/**
 * write-registry/validate.ts — validateDecision (AI_MIMARI_V2 §3.2 T5, §5). PURE: no I/O, no
 * clock (the caller passes `today`/`now_iso`), no reading of the user's words except the
 * verbatim evidence check.
 *
 * Every write gets exactly one verdict:
 *   COMMIT — store the model's args + the op's declared derive(), as_stated kept.
 *   FLAG   — store exactly the same; the doubt rides along to the coach and the receipt meta.
 *   ASK    — do not store; hold it (pending_writes) and let the coach ask ONE question.
 *   REJECT — do not store; ok:false with a failure_class and a Turkish reason. `repairable`
 *            marks the cases one repair call to Stage A could fix (unit=other without ml).
 *
 * Nothing is rewritten. `args` is a copy of what the model sent; `row` (what the writer persists)
 * differs from it ONLY by declared derive() output and lossless column normalisations, each listed
 * in `normalized[]`. derive() and the op rules see the args WITH those column fits applied, so a
 * value derive() passes through (a meal item's own kcal) is the fitted one — the row can never
 * carry 312.5 into an integer column while normalized[] says 313. registry.test.ts checks that
 * leaf by leaf.
 */
import { MAX_BACK_DAYS, type Channel, type EvalOpts, type FieldSpec, type Fields, type Issue, type RegOp, type ValidationContext } from './dsl.ts';
import { ENVELOPE_HEAD, ENVELOPE_TAIL, NOT_WRITTEN_REASONS } from './envelope.ts';
import { parseRef } from './refs.ts';
import { CHANNELS, findWireOp, getOp, SCHEMA_VERSION, UNDERSTAND_CHANNELS } from './registry.ts';
import { cloneJson, daysBetween, isHhmm, isIsoDay, isRecord, isVerbatimQuote, RELATIVE_DAY_TOKENS, resolveDay, roundTo } from './util.ts';

export type Verdict = 'COMMIT' | 'FLAG' | 'ASK' | 'REJECT';

/** A declared reason a reported fact was not written (envelope.ts NOT_WRITTEN_REASONS). */
export type NotWrittenReason = keyof typeof NOT_WRITTEN_REASONS;

/** A lossless column fit (SMALLINT, NUMERIC(5,1)…) — the only change code makes to a model number. */
export interface Normalization {
  path: string;
  from: number;
  to: number;
  why_tr: string;
}

export interface WriteVerdict {
  channel: Channel;
  /** Position in the decision's channel array. */
  index: number;
  /** For atomic-list ops (profile_set): which element; otherwise null. */
  part: number | null;
  /** Registry op type ('meal_log', 'record_delete'…); 'unknown' when the model named no registry op. */
  op: string;
  /** Legacy envelope action type (client BADGE_DEFS). */
  envelope: string;
  verdict: Verdict;
  /** The model declared "nothing to store" (meal restatement): valid, written as nothing. */
  noop: string | null;
  issues: Issue[];
  /** Exactly what the model sent (a deep copy; the decision object is never mutated). */
  args: Record<string, unknown>;
  derived: Record<string, unknown>;
  normalized: Normalization[];
  /** args (declared fields) ⊕ derived ⊕ normalized — what the writer persists. null unless COMMIT/FLAG. */
  row: Record<string, unknown> | null;
  repairable: boolean;
  /** ASK: the one question the coach should ask (in its own words). */
  question_tr: string | null;
  /** ASK: pending_writes.op for the hold. */
  hold_op: string | null;
  /**
   * ASK: the payload to persist for the hold — `args` with every relative day ('today',
   * 'yesterday') frozen to the date it meant THIS turn, so a "yes" after midnight writes to the
   * right day. Refs inside still need collectRefs() → row ids before persisting. null otherwise.
   */
  hold_args: Record<string, unknown> | null;
  /** The record this op acts on (record/pending/commitment ref, or a write's `replaces`). */
  target_ref: string | null;
}

export interface PlanVerdict {
  op: string;
  plan_type: string | null;
  draft_ref: string | null;
  verdict: Verdict;
  issues: Issue[];
}

export interface DecisionValidation {
  schema_version: string;
  verdicts: WriteVerdict[];
  plan: PlanVerdict | null;
  /** Envelope-level findings (malformed sections, clarify refs not shown, intent/write mismatch). */
  decision_issues: Issue[];
  safety: {
    /** ED signal accepted only with a verbatim USER quote (final2#9); escalation never from the model alone. */
    ed_signal: null | { accepted: boolean; escalate: 'medium' | 'high' | null; reason_tr: string };
  };
  /** One repair call (§3.2 T5) is worth it: some REJECT is fixable from what the model knows. */
  repair: { needed: boolean; items: Array<{ channel: Channel; index: number; op: string; issues: Issue[] }> };
  /**
   * self_check said "user reported something" but nothing was written or clarified AND no
   * not_written_reason was given (§5.1.10) — an unexplained omission; the coach asks.
   */
  missed_write: boolean;
  /**
   * The model's declared reason (a NOT_WRITTEN_REASONS id) for a reported-but-unwritten fact — then
   * the turn is NOT a missed write; the facts layer acts on the reason. null when something was
   * written or clarified, nothing was reported, or no declared reason was given.
   */
  not_written_reason: NotWrittenReason | null;
  counts: Record<Verdict, number>;
}

// ─── structural field checks ─────────────────────────────────────────────────

interface Acc {
  issues: Issue[];
  normalized: Normalization[];
}

function hard(acc: Acc, code: string, tr: string, path: string, failure_class: string, repairable: boolean): void {
  acc.issues.push({ code, level: 'hard', tr, path, failure_class, repairable });
}

const sub = (base: string, key: string | number) =>
  typeof key === 'number' ? `${base}[${key}]` : base ? `${base}.${key}` : key;

function checkRef(spec: Extract<FieldSpec, { kind: 'ref' }>, v: string, path: string, ctx: ValidationContext, acc: Acc): void {
  const parsed = parseRef(v);
  if (!parsed) return hard(acc, 'ref_bicimi', `"${v}" geçerli bir ref değil`, path, 'invalid_ref', true);
  if (!spec.kinds.includes(parsed.kind)) {
    return hard(acc, 'ref_turu', `${path}: ${spec.kinds.join('/')} türünde ref beklenir, "${v}" geldi`, path, 'invalid_ref', true);
  }
  const r = ctx.refs[v];
  if (!r) return hard(acc, 'ref_listede_yok', `${v} bu turda gösterilen kayıtlar arasında yok`, path, 'invalid_ref', false);
  if (spec.targets && !spec.targets.includes(r.target)) {
    return hard(acc, 'ref_hedefi', `${v} bir ${spec.targets.join('/')} kaydı değil`, path, 'invalid_ref', true);
  }
  if (r.undone) hard(acc, 'zaten_geri_alindi', `${v} zaten geri alınmış`, path, 'already_undone', false);
}

function checkField(spec: FieldSpec, v: unknown, path: string, ctx: ValidationContext, acc: Acc): void {
  if (v === null && 'nullable' in spec && spec.nullable) return;
  const typeErr = (want: string) => hard(acc, 'tip_hatasi', `${path}: ${want} bekleniyordu`, path, 'invalid_value', true);
  switch (spec.kind) {
    case 'num': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return typeErr('sayı');
      if (spec.hard && (v < spec.hard[0] || v > spec.hard[1])) {
        return hard(acc, 'aralik_disi', `${path}: ${v} mümkün değil (${spec.hard[0]}–${spec.hard[1]}${spec.unit ? ' ' + spec.unit : ''})`, path, 'out_of_range', false);
      }
      if (spec.plausible && (v < spec.plausible[0] || v > spec.plausible[1])) {
        acc.issues.push({ code: 'alisilmadik_deger', level: 'ask', tr: `${path}: ${v} alışılmadık`, path, question_tr: 'Bu değeri doğru anladım mı?' });
      }
      if (spec.decimals !== undefined) {
        const to = roundTo(v, spec.decimals);
        if (to !== v) acc.normalized.push({ path, from: v, to, why_tr: spec.decimals === 0 ? 'tam sayı sütunu' : `${spec.decimals} ondalık sütun` });
      }
      return;
    }
    case 'text': {
      if (typeof v !== 'string') return typeErr('metin');
      if (spec.max !== undefined && v.length > spec.max) {
        acc.issues.push({ code: 'metin_uzun', level: 'flag', tr: `${path}: ${v.length} karakter (önerilen ≤${spec.max}); kısaltılmadan saklandı`, path });
      }
      if (spec.format === 'hhmm' && !isHhmm(v)) {
        acc.issues.push({ code: 'saat_bicimi', level: 'ask', tr: `${path}: "${v}" HH:MM değil`, path, question_tr: 'Saati tam olarak söyler misin (ör. 07:30)?' });
      }
      return;
    }
    case 'bool':
      if (typeof v !== 'boolean') typeErr('true/false');
      return;
    case 'enum':
      if (typeof v !== 'string' || !Object.prototype.hasOwnProperty.call(spec.values, v)) {
        hard(acc, 'gecersiz_secenek', `${path}: "${String(v)}" geçerli bir seçenek değil`, path, 'invalid_value', true);
      }
      return;
    case 'enumList': {
      if (!Array.isArray(v)) return typeErr('liste');
      v.forEach((x, i) => {
        if (typeof x !== 'string' || !Object.prototype.hasOwnProperty.call(spec.values, x)) {
          hard(acc, 'gecersiz_secenek', `${sub(path, i)}: "${String(x)}" geçerli bir seçenek değil`, sub(path, i), 'invalid_value', true);
        }
      });
      return;
    }
    case 'textList':
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) typeErr('metin listesi');
      return;
    case 'day': {
      const day = resolveDay(v, ctx.today);
      if (day === null) return hard(acc, 'gun_bicimi', `${path}: today, yesterday ya da YYYY-MM-DD bekleniyordu`, path, 'invalid_value', true);
      const ago = daysBetween(day, ctx.today);
      if (ago < 0) return hard(acc, 'gelecek_tarih', `${path}: ${day} gelecekte; gelecek tarihe kayıt yazılmaz`, path, 'future_date', false);
      if (ago > MAX_BACK_DAYS) hard(acc, 'cok_eski', `${path}: ${day} ${MAX_BACK_DAYS} günden eski`, path, 'too_old', false);
      return;
    }
    case 'date': {
      if (!isIsoDay(v)) return hard(acc, 'tarih_bicimi', `${path}: YYYY-MM-DD bekleniyordu`, path, 'invalid_value', true);
      const ago = daysBetween(v, ctx.today);
      if (spec.past_days !== undefined && ago > spec.past_days) {
        return hard(acc, 'tarih_araligi', `${path}: ${v} izin verilen aralığın dışında (çok eski)`, path, 'out_of_range', false);
      }
      if (spec.future_days !== undefined && -ago > spec.future_days) {
        hard(acc, 'tarih_araligi', `${path}: ${v} izin verilen aralığın dışında (çok ileri)`, path, 'out_of_range', false);
      }
      return;
    }
    case 'ref':
      if (typeof v !== 'string') return typeErr('ref');
      return checkRef(spec, v, path, ctx, acc);
    case 'list': {
      if (!Array.isArray(v)) return typeErr('liste');
      if (v.length < spec.min) hard(acc, 'liste_kisa', `${path}: en az ${spec.min} öğe gerekli`, path, 'missing_field', true);
      if (v.length > spec.max) hard(acc, 'liste_uzun', `${path}: en fazla ${spec.max} öğe`, path, 'invalid_value', true);
      v.forEach((item, i) => checkObject(spec.fields, item, sub(path, i), ctx, acc));
      return;
    }
    case 'obj':
      return checkObject(spec.fields, v, path, ctx, acc);
    case 'write':
      // The nested write is validated as a whole by validateRecordUpdate.
      if (!isRecord(v) || typeof v.op !== 'string') typeErr('op içeren bir yazma');
      return;
  }
}

function checkObject(fields: Fields, v: unknown, path: string, ctx: ValidationContext, acc: Acc, allowed: readonly string[] = []): void {
  if (!isRecord(v)) return hard(acc, 'tip_hatasi', `${path || 'yazma'}: nesne bekleniyordu`, path, 'invalid_value', true);
  for (const [name, spec] of Object.entries(fields)) {
    if (!Object.prototype.hasOwnProperty.call(v, name)) {
      hard(acc, 'alan_eksik', `${sub(path, name)} eksik`, sub(path, name), 'missing_field', true);
      continue;
    }
    checkField(spec, v[name], sub(path, name), ctx, acc);
  }
  for (const k of Object.keys(v)) {
    if (!Object.prototype.hasOwnProperty.call(fields, k) && !allowed.includes(k)) {
      acc.issues.push({ code: 'fazla_alan', level: 'flag', tr: `${sub(path, k)} tanımlı bir alan değil; yok sayıldı`, path: sub(path, k) });
    }
  }
}

// ─── rows: args ⊕ derived ⊕ normalized ───────────────────────────────────────

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.match(/[^.[\]]+/g) ?? [];
  let cur: unknown = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    cur = Array.isArray(cur) ? cur[Number(k)] : isRecord(cur) ? cur[k] : undefined;
    if (cur === undefined || cur === null) return;
  }
  const last = keys[keys.length - 1];
  if (Array.isArray(cur)) cur[Number(last)] = value;
  else if (isRecord(cur)) cur[last] = value;
}

/** derive() output is laid over the args; arrays of objects merge element-wise (meal items). */
function overlay(base: unknown, top: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(top)) {
    return top.length === base.length ? base.map((b, i) => overlay(b, top[i])) : cloneJson(top);
  }
  if (isRecord(base) && isRecord(top)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(top)) out[k] = k in base ? overlay(base[k], v) : cloneJson(v);
    return out;
  }
  return cloneJson(top);
}

/** The model's args with the listed lossless column fits applied (a copy; args stay untouched). */
function fitted(args: Record<string, unknown>, normalized: Normalization[]): Record<string, unknown> {
  const out = cloneJson(args);
  for (const n of normalized) setPath(out, n.path, n.to);
  return out;
}

/**
 * row = fitted args ⊕ derive(). derive() was computed FROM the fitted args, so anything it echoes
 * is already fitted; anything it computes (a picked reference's kcal) is its declared output.
 */
function buildRow(fields: Fields, fittedArgs: Record<string, unknown>, derived: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const name of Object.keys(fields)) row[name] = cloneJson(fittedArgs[name]);
  return overlay(row, derived) as Record<string, unknown>;
}

// ─── holds: relative days are frozen when the hold is made ───────────────────

/** Walk every `day` field of a write's args (nested lists/objects and a record_update patch). */
function walkDays(fields: Fields, obj: unknown, base: string, visit: (holder: Record<string, unknown>, key: string, path: string) => void): void {
  if (!isRecord(obj)) return;
  for (const [name, spec] of Object.entries(fields)) {
    const v = obj[name];
    const p = sub(base, name);
    if (spec.kind === 'day') visit(obj, name, p);
    else if (spec.kind === 'list' && Array.isArray(v)) v.forEach((it, i) => walkDays(spec.fields, it, sub(p, i), visit));
    else if (spec.kind === 'obj') walkDays(spec.fields, v, p, visit);
    else if (spec.kind === 'write' && isRecord(v)) {
      const inner = findWireOp('writes', v.op);
      if (inner) walkDays(inner.fields, v, p, visit);
    }
  }
}

const RELATIVE_DAYS: readonly unknown[] = RELATIVE_DAY_TOKENS;

/**
 * The hold payload for a write: a copy of `args` with 'today'/'yesterday' resolved against the
 * day the hold was made. Ref tokens are left as they are (collectRefs() lists them for the caller).
 */
export function freezeForHold(op: string, args: Record<string, unknown>, today: string): Record<string, unknown> {
  const out = cloneJson(args);
  const reg = getOp(op);
  if (reg) {
    walkDays(reg.fields, out, '', (holder, key) => {
      if (RELATIVE_DAYS.includes(holder[key])) holder[key] = resolveDay(holder[key], today);
    });
  }
  return out;
}

function relativeDayPaths(reg: RegOp, args: Record<string, unknown>): string[] {
  const out: string[] = [];
  walkDays(reg.fields, args, '', (holder, key, path) => {
    if (RELATIVE_DAYS.includes(holder[key])) out.push(path);
  });
  return out;
}

// ─── per-write validation ────────────────────────────────────────────────────

function aggregate(issues: Issue[], noop: string | null): Verdict {
  if (issues.some((i) => i.level === 'hard')) return 'REJECT';
  if (noop) return 'COMMIT';
  if (issues.some((i) => i.level === 'ask')) return 'ASK';
  if (issues.some((i) => i.level === 'flag')) return 'FLAG';
  return 'COMMIT';
}

function targetRefOf(args: Record<string, unknown>): string | null {
  for (const k of ['ref', 'target', 'replaces']) if (typeof args[k] === 'string') return args[k] as string;
  return null;
}

interface Built {
  derived: Record<string, unknown>;
  noop: string | null;
  envelope: string;
  /** Fitted args (column fits applied) — the base of the row. */
  fittedArgs: Record<string, unknown>;
  rowOverride?: (row: Record<string, unknown>) => void;
}

function finish(
  reg: RegOp, channel: Channel, index: number, part: number | null, args: Record<string, unknown>, acc: Acc, b: Built, ctx: ValidationContext, opts: EvalOpts,
): WriteVerdict {
  // A hold the user explicitly confirmed: its questions are answered. They stay visible as notes
  // (FLAG), while every hard rule is re-checked against today's state (ED tier may have moved).
  if (opts.confirmed) {
    acc.issues = acc.issues.map((i) => i.level === 'ask' ? { code: i.code, level: 'flag', tr: `kullanıcı onayladı — ${i.tr}`, ...(i.path ? { path: i.path } : {}) } : i);
  }
  const verdict = aggregate(acc.issues, b.noop);
  const hardIssues = acc.issues.filter((i) => i.level === 'hard');
  const ask = acc.issues.find((i) => i.level === 'ask');
  let row: Record<string, unknown> | null = null;
  if ((verdict === 'COMMIT' || verdict === 'FLAG') && !b.noop) {
    row = buildRow(reg.fields, b.fittedArgs, b.derived);
    b.rowOverride?.(row);
  }
  return {
    channel, index, part, op: reg.type, envelope: b.envelope, verdict, noop: b.noop,
    issues: acc.issues,
    args,
    derived: b.derived,
    normalized: acc.normalized,
    row,
    repairable: verdict === 'REJECT' && hardIssues.every((i) => i.repairable === true),
    question_tr: verdict === 'ASK' ? (ask?.question_tr ?? ask?.tr ?? null) : null,
    hold_op: verdict === 'ASK' ? (reg.writes.hold_op ?? reg.type) : null,
    hold_args: verdict === 'ASK' ? freezeForHold(reg.type, args, ctx.today) : null,
    target_ref: targetRefOf(args),
  };
}

function validateOne(
  reg: RegOp, channel: Channel, index: number, part: number | null, args: Record<string, unknown>, ctx: ValidationContext,
  opts: EvalOpts & { preIssues?: Issue[] } = {},
): WriteVerdict {
  const acc: Acc = { issues: [...(opts.preIssues ?? [])], normalized: [] };
  checkObject(reg.fields, args, '', ctx, acc, ['op']);
  // Atomic-list ops are split by validateChannelItems; validated directly (inside a patch, or as a
  // confirmed hold) they must carry exactly one element, or the rules would only see the first.
  if (reg.atomic_list && Array.isArray(args[reg.atomic_list]) && (args[reg.atomic_list] as unknown[]).length !== 1) {
    hard(acc, 'tek_oge_bekleniyor', `${reg.atomic_list}: burada tam bir öğe olmalı`, reg.atomic_list, 'invalid_value', true);
  }
  const structuralHard = acc.issues.some((i) => i.level === 'hard');
  const b: Built = { derived: {}, noop: null, envelope: safeEnvelope(reg, args), fittedArgs: fitted(args, acc.normalized) };

  // §4.4(3): a correction must not clobber a newer write of the same field — for record_ops AND for
  // a log op's own `replaces` (restore_previous would wipe the later value).
  if (reg.fields.replaces?.kind === 'ref' && typeof args.replaces === 'string' && ctx.refs[args.replaces]?.later_write_on_same_field === true) {
    hard(acc, 'sonraki_yazma_var', `${args.replaces} sonrasında aynı alana yeniden yazılmış; düzeltmek sonrakini ezer`, 'replaces', 'conflict', false);
  }

  if (!structuralHard) {
    try {
      const ev = reg.evaluate(b.fittedArgs, ctx, opts);
      b.derived = ev.derived;
      b.noop = ev.noop;
      acc.issues.push(...ev.issues);
    } catch (e) {
      // A rule/derive bug must surface as a visible REJECT, never crash the turn or pass silently.
      hard(acc, 'denetim_hatasi', `denetim çalıştırılamadı: ${(e as Error).message}`, '', 'validator_error', false);
    }
  }

  // record_ops.update: the patch is a full write of the record's own type, validated by that op.
  if (reg.type === 'record_update' && !acc.issues.some((i) => i.level === 'hard') && isRecord(args.patch)) {
    const patchReg = findWireOp('writes', args.patch.op);
    if (!patchReg) {
      hard(acc, 'yama_bilinmeyen_op', `patch.op "${String(args.patch.op)}" bir yazma türü değil`, 'patch.op', 'invalid_value', true);
    } else {
      const nested = validateOne(patchReg, 'writes', index, null, args.patch, ctx, { confirmed: opts.confirmed });
      for (const i of nested.issues) acc.issues.push({ ...i, path: i.path ? `patch.${i.path}` : 'patch' });
      for (const n of nested.normalized) acc.normalized.push({ ...n, path: `patch.${n.path}` });
      b.derived = { ...b.derived, patch: nested.derived };
      b.envelope = nested.envelope;
      b.rowOverride = (row) => {
        row.patch = nested.row ?? buildRow(patchReg.fields, fitted(args.patch as Record<string, unknown>, nested.normalized), nested.derived);
      };
    }
  }
  return finish(reg, channel, index, part, args, acc, b, ctx, opts);
}

/**
 * pending_ops.confirm{p#} → re-validate the held write (pending_writes.op = verdict.hold_op) as a
 * CONFIRMED write: its ASK reasons become FLAG notes, hard STATE rules still REJECT (state may have
 * moved since the question), and evidence rules — which read the turn's own message and were
 * decided when the hold was made — are not re-run against the "evet". `args` must be the persisted
 * `hold_args` (relative days frozen); a payload that still says 'today'/'yesterday' is refused
 * rather than written to the confirming day. The hold's payload stores row ids for its refs
 * (collectRefs); the caller maps them back to THIS turn's tokens — the loader renders those rows —
 * before calling. Returns null for holds that are not registry ops (the KVKK erase hold runs
 * through shared/erase-hold.ts).
 */
export function validateConfirmedHold(holdOp: string, args: Record<string, unknown>, ctx: ValidationContext): WriteVerdict | null {
  const reg = getOp(holdOp);
  if (!reg) return null;
  const copy = cloneJson(args);
  const preIssues: Issue[] = relativeDayPaths(reg, copy).map((path) => ({
    code: 'bekletme_gunu_goreli', level: 'hard', path, failure_class: 'invalid_hold', repairable: false,
    tr: `${path}: bekletme göreli gün (today/yesterday) taşıyor; hangi güne yazılacağı belirsiz — bekletmede hold_args saklanmalı`,
  }));
  return validateOne(reg, reg.channel, 0, null, copy, ctx, { confirmed: true, preIssues });
}

/**
 * Every ref token inside a write's args, with its path — the commit layer must resolve these to
 * row ids before persisting a hold: refs are turn-scoped (m12 next turn may be another row).
 */
export function collectRefs(op: string, args: Record<string, unknown>): Array<{ path: string; ref: string }> {
  const reg = getOp(op);
  const out: Array<{ path: string; ref: string }> = [];
  const walk = (fields: Fields, obj: unknown, base: string) => {
    if (!isRecord(obj)) return;
    for (const [name, spec] of Object.entries(fields)) {
      const v = obj[name];
      const p = sub(base, name);
      if (spec.kind === 'ref' && typeof v === 'string') out.push({ path: p, ref: v });
      else if (spec.kind === 'list' && Array.isArray(v)) v.forEach((it, i) => walk(spec.fields, it, sub(p, i)));
      else if (spec.kind === 'obj') walk(spec.fields, v, p);
      else if (spec.kind === 'write' && isRecord(v)) {
        const inner = findWireOp('writes', v.op);
        if (inner) walk(inner.fields, v, p);
      }
    }
  };
  if (reg) walk(reg.fields, args, '');
  return out;
}

function safeEnvelope(reg: RegOp, args: Record<string, unknown>): string {
  try {
    return reg.envelopeFor(args) ?? reg.type;
  } catch {
    return reg.type; // malformed args can break an envelope mapper; the verdict is REJECT anyway
  }
}

function unknownOp(channel: Channel, index: number, raw: unknown): WriteVerdict {
  const args = isRecord(raw) ? cloneJson(raw) : { value: cloneJson(raw) ?? null };
  const name = isRecord(raw) && typeof raw.op === 'string' ? raw.op : '?';
  const issue: Issue = {
    code: 'bilinmeyen_islem', level: 'hard', tr: `"${name}" ${channel} içinde tanımlı bir işlem değil`,
    path: 'op', failure_class: 'unknown_op', repairable: true,
  };
  return {
    channel, index, part: null, op: 'unknown', envelope: name, verdict: 'REJECT', noop: null, issues: [issue],
    args, derived: {}, normalized: [], row: null, repairable: true, question_tr: null, hold_op: null, hold_args: null, target_ref: null,
  };
}

/** Validate the items of one channel array (Stage A's arrays, or Stage B's memory[]). */
export function validateChannelItems(channel: Channel, items: unknown, ctx: ValidationContext): WriteVerdict[] {
  if (!Array.isArray(items)) return [];
  const out: WriteVerdict[] = [];
  items.forEach((raw, index) => {
    const reg = isRecord(raw) ? findWireOp(channel, raw.op) : undefined;
    if (!reg || !isRecord(raw)) return void out.push(unknownOp(channel, index, raw));
    const args = cloneJson(raw);
    const list = reg.atomic_list;
    if (list && Array.isArray(args[list]) && (args[list] as unknown[]).length > 0) {
      (args[list] as unknown[]).forEach((el, part) => out.push(validateOne(reg, channel, index, part, { ...args, [list]: [el] }, ctx)));
    } else {
      out.push(validateOne(reg, channel, index, null, args, ctx));
    }
  });
  return out;
}

// ─── envelope-level checks ───────────────────────────────────────────────────

function validatePlan(present: boolean, raw: unknown, ctx: ValidationContext): PlanVerdict | null {
  if (!present) return null; // reported once as alan_eksik at envelope level
  const acc: Acc = { issues: [], normalized: [] };
  if (!isRecord(raw)) {
    // A json_object fallback can send null here; the field is not nullable — never pass silently.
    hard(acc, 'tip_hatasi', 'plan_action: nesne bekleniyordu (plan işlemi yoksa op none)', 'plan_action', 'invalid_value', true);
    return { op: 'none', plan_type: null, draft_ref: null, verdict: 'REJECT', issues: acc.issues };
  }
  checkObject(ENVELOPE_TAIL.plan_action.fields, raw, 'plan_action', ctx, acc);
  const op = typeof raw.op === 'string' ? raw.op : 'none';
  const draft_ref = typeof raw.draft_ref === 'string' ? raw.draft_ref : null;
  const plan_type = typeof raw.plan_type === 'string' ? raw.plan_type : null;
  if (['approve', 'revise', 'explain', 'discard'].includes(op) && draft_ref === null) {
    hard(acc, 'taslak_ref_yok', `plan_action ${op} için açık taslağın dft-ref’i gerekli`, 'plan_action.draft_ref', 'missing_field', true);
  }
  if (op === 'generate' && plan_type === null) {
    hard(acc, 'plan_tipi_yok', 'plan_action generate için plan_type gerekli', 'plan_action.plan_type', 'missing_field', true);
  }
  return { op, plan_type, draft_ref, verdict: aggregate(acc.issues, null), issues: acc.issues };
}

function validateEdSignal(safety: unknown, ctx: ValidationContext): DecisionValidation['safety']['ed_signal'] {
  if (!isRecord(safety) || !isRecord(safety.ed_signal)) return null;
  const s = safety.ed_signal;
  if (!isVerbatimQuote(s.evidence_quote, ctx.user_message)) {
    return { accepted: false, escalate: null, reason_tr: 'kanıt alıntısı kullanıcının mesajında aynen yok (koçun sözleri sayılmaz)' };
  }
  if (s.category === 'illness_vomiting') return { accepted: true, escalate: null, reason_tr: 'hastalık kaynaklı; YB yükseltmesi yok' };
  const escalate = s.severity === 'medium' || s.severity === 'high' ? s.severity : null;
  return { accepted: true, escalate, reason_tr: escalate ? `YB sinyali (${String(s.category)})` : 'düşük şiddet; yükseltme yok' };
}

/**
 * Validate a Stage A decision (or a fused envelope — memory[] is validated when present).
 * Accepts `unknown` because a json_object fallback gateway gives no schema guarantee.
 */
export function validateDecision(decision: unknown, ctx: ValidationContext): DecisionValidation {
  const d = isRecord(decision) ? decision : {};
  const env: Acc = { issues: [], normalized: [] };
  if (!isRecord(decision)) hard(env, 'karar_nesne_degil', 'karar bir JSON nesnesi değil', '', 'invalid_value', true);

  for (const [name, spec] of Object.entries({ ...ENVELOPE_HEAD, ...ENVELOPE_TAIL })) {
    if (!(name in d)) hard(env, 'alan_eksik', `${name} eksik`, name, 'missing_field', true);
    else if (name !== 'plan_action') checkField(spec, d[name], name, ctx, env);
  }

  const verdicts: WriteVerdict[] = [];
  for (const ch of CHANNELS) {
    if (!(ch in d)) {
      if ((UNDERSTAND_CHANNELS as readonly string[]).includes(ch)) hard(env, 'alan_eksik', `${ch} eksik`, ch, 'missing_field', true);
      continue;
    }
    if (!Array.isArray(d[ch])) {
      hard(env, 'tip_hatasi', `${ch}: liste bekleniyordu`, ch, 'invalid_value', true);
      continue;
    }
    verdicts.push(...validateChannelItems(ch, d[ch], ctx));
  }

  const clarify = isRecord(d.clarify) ? d.clarify : null;
  if (clarify && Array.isArray(clarify.candidate_refs)) {
    for (const r of clarify.candidate_refs) {
      if (typeof r !== 'string' || !ctx.refs[r]) {
        env.issues.push({ code: 'clarify_ref_listede_yok', level: 'flag', tr: `clarify adayı ${String(r)} gösterilen kayıtlarda yok`, path: 'clarify.candidate_refs' });
      }
    }
  }

  const intent = isRecord(d.intent) ? d.intent : null;
  if (intent?.is_hypothetical === true && verdicts.some((v) => v.channel === 'writes')) {
    env.issues.push({ code: 'niyet_yazma_celiskisi', level: 'flag', tr: 'mesaj varsayım olarak okunmuş ama kayıt yazması var', path: 'intent' });
  }

  // §5.1.10: a missed write is an UNEXPLAINED omission. When the model says why it wrote nothing it
  // decided, it did not forget — the facts layer reads that reason and the route; it must not ALSO
  // get a "kullanıcı bir şey bildirdi ama yazılmadı → sor" fact (an emergency turn would otherwise end
  // in a data-entry question). The reason is a CLOSED enum (NOT_WRITTEN_REASONS: emergency_turn,
  // illness_not_food, …): only a declared id explains; free text, a blank or an unknown id (a
  // json_object fallback) is still a miss — never an excuse code has to interpret.
  const selfCheck = isRecord(d.self_check) ? d.self_check : null;
  const wroteSomething = verdicts.some((v) => v.channel !== 'memory');
  const reason = selfCheck?.not_written_reason;
  const reasonGiven = typeof reason === 'string' && Object.prototype.hasOwnProperty.call(NOT_WRITTEN_REASONS, reason);
  const unwritten = selfCheck?.reported_new_facts === true && !wroteSomething && clarify === null;
  const missed_write = unwritten && !reasonGiven;
  const not_written_reason = unwritten && reasonGiven ? reason as NotWrittenReason : null;

  const repairItems = verdicts
    .filter((v) => v.verdict === 'REJECT' && v.repairable)
    .map((v) => ({ channel: v.channel, index: v.index, op: v.op, issues: v.issues.filter((i) => i.level === 'hard') }));

  const counts: Record<Verdict, number> = { COMMIT: 0, FLAG: 0, ASK: 0, REJECT: 0 };
  for (const v of verdicts) counts[v.verdict]++;

  const plan = validatePlan('plan_action' in d, d.plan_action, ctx);
  const fixable = (issues: readonly Issue[]) => issues.some((i) => i.level === 'hard' && i.repairable);

  return {
    schema_version: SCHEMA_VERSION,
    verdicts,
    plan,
    decision_issues: env.issues,
    safety: { ed_signal: validateEdSignal(d.safety, ctx) },
    repair: { needed: repairItems.length > 0 || fixable(env.issues) || fixable(plan?.issues ?? []), items: repairItems },
    missed_write,
    not_written_reason,
    counts,
  };
}

/** Look up the registry op behind a verdict (convenience for commit/receipt layers). */
export function opOf(v: WriteVerdict): RegOp | undefined {
  return getOp(v.op);
}
