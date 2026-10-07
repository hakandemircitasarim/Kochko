/**
 * ai-chat/v2/shadow-report.mjs — the §10 Faz 2 daily shadow report, as PURE functions.
 *
 * Input: ai_turn_log rows written by ai-chat/v2/shadow.ts (pipeline 'v2_shadow', stage
 * 'understand'). Output: one summary object and a plain-text rendering of it. No I/O here —
 * scripts/v2-shadow-diff.mjs fetches the rows (service role REST) and prints; shadow-report.test.ts
 * feeds it rows produced by the real shadowTurnLogRow(), so writer and report cannot drift apart.
 *
 * Plain JavaScript (JSDoc) on purpose: Node runs the script, Deno runs the test, neither needs a
 * build step. The report never prints user ids, messages or decisions — counts and codes only.
 *
 * What it answers (§10 Faz 2):
 *   · per-op agreement v1 ↔ v2 (both / v1_only / v2_only)
 *   · turns where a v1 NET fired but v2 stayed silent, and the reverse (v2 would write, v1 did not)
 *   · ASK / REJECT rates (per verdict and per turn) with their top codes
 *   · parse / schema errors (refused, invalid, incomplete, error) and skipped turns
 *   · Stage A latency p50 / p90 and the share over the live 4 s budget
 *   · tripwire × reading matrix and the §7.2 outcome counts
 *   · writes v2 would make on QUESTION / HYPOTHETICAL turns (the A′ "must not write" class) and the
 *     FLAG codes, split by that intent (wave-2a review: watch koruyucu_beyan_teyidi on such turns)
 */

/** Live Stage A budget (§7.2) — mirrors understand.ts STAGE_A_LIVE_BUDGET_MS. */
export const LIVE_BUDGET_MS = 4000;

/**
 * Nearest-rank percentile of a numeric list (null when empty).
 * @param {unknown[]} values @param {number} p @returns {number | null}
 */
export function percentile(values, p) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const rank = Math.min(v.length, Math.max(1, Math.ceil((p / 100) * v.length)));
  return v[rank - 1];
}

/** @param {Record<string, number>} obj @param {string} key */
const inc = (obj, key, by = 1) => { obj[key] = (obj[key] ?? 0) + by; };
/** @param {number} n @param {number} d @returns {number | null} */
const rate = (n, d) => (d > 0 ? n / d : null);
/** @param {unknown} v @returns {any[]} */
const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * finish_reason → 'parsed' | 'refused' | 'invalid' | 'incomplete' | 'function_call' | 'error' | 'skipped'.
 * @param {unknown} finishReason
 * @returns {'parsed'|'refused'|'invalid'|'incomplete'|'function_call'|'error'|'skipped'}
 */
export function stageAStatusOf(finishReason) {
  const s = typeof finishReason === 'string' ? finishReason : '';
  const head = s.split(':')[0];
  const known = /** @type {const} */ (['parsed', 'refused', 'invalid', 'incomplete', 'function_call', 'error', 'skipped']);
  return /** @type {readonly string[]} */ (known).includes(head) ? /** @type {typeof known[number]} */ (head) : 'error';
}

/** @param {Record<string, number>} counts @returns {Array<[string, number]>} */
function topN(counts, n = 5) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n);
}

/**
 * @typedef {{ both: number, v1_only: number, v2_only: number, neither: number, agreement_rate: number | null }} OpAgreement
 * @typedef {{ total: number, commit: number, flag: number, ask: number, reject: number }} OutcomeCounts
 * @typedef {{ tier: string, positive: number, benign: number, missing: number, 'n/a': number }} TripwireRow
 * @typedef {{
 *   rows: number, ran: number,
 *   status: Record<'parsed'|'refused'|'invalid'|'incomplete'|'function_call'|'error'|'skipped', number>,
 *   skipped: Record<string, number>, errors: Record<string, number>, parse_error_rate: number | null,
 *   latency: { n: number, p50: number | null, p90: number | null, over_live_budget: number },
 *   tokens: { input_avg: number | null, cached_ratio: number | null, output_avg: number | null, reasoning_avg: number | null },
 *   ops: Record<string, OpAgreement>,
 *   net_fired_v2_silent: Record<string, number>, model_fired_v2_silent: Record<string, number>,
 *   v2_fired_v1_silent: Record<string, { write: number, ask: number }>,
 *   verdicts: OutcomeCounts & { per_op: Record<string, OutcomeCounts>, ask_codes: Record<string, number>, reject_codes: Record<string, number>,
 *     flag_codes: Record<string, number>, flag_codes_on_question: Record<string, number>,
 *     ask_rate: number | null, reject_rate: number | null, top_ask_codes: Array<[string, number]>, top_reject_codes: Array<[string, number]>,
 *     top_flag_codes: Array<[string, number]> },
 *   intents: Record<string, number>, hypothetical: number, writes_on_question: Record<string, number>,
 *   turns_with_verdicts: number, turns_with_ask: number, turns_with_reject: number,
 *   turn_ask_rate: number | null, turn_reject_rate: number | null, missed_write: number, not_written_explained: number,
 *   tripwire: { matrix: Record<string, TripwireRow>, outcomes: Record<string, number>, benign_suppressed: number, v1_safety: Record<string, number> },
 *   v1_sources: { model: number, net: number, unknown: number },
 * }} ShadowSummary
 */

const OUTCOMES = ['commit', 'flag', 'ask', 'reject'];

/**
 * Aggregate shadow rows.
 * @param {Array<Record<string, any>>} rows
 * @returns {ShadowSummary}
 */
export function summarizeShadowRows(rows) {
  /** @type {ShadowSummary} */
  const s = {
    rows: rows.length,
    ran: 0,
    status: { parsed: 0, refused: 0, invalid: 0, incomplete: 0, function_call: 0, error: 0, skipped: 0 },
    skipped: {},
    errors: {},
    parse_error_rate: null,
    latency: { n: 0, p50: null, p90: null, over_live_budget: 0 },
    tokens: { input_avg: null, cached_ratio: null, output_avg: null, reasoning_avg: null },
    ops: {},
    net_fired_v2_silent: {},
    model_fired_v2_silent: {},
    v2_fired_v1_silent: {},
    verdicts: {
      total: 0, commit: 0, flag: 0, ask: 0, reject: 0, per_op: {}, ask_codes: {}, reject_codes: {},
      flag_codes: {}, flag_codes_on_question: {},
      ask_rate: null, reject_rate: null, top_ask_codes: [], top_reject_codes: [], top_flag_codes: [],
    },
    intents: {},
    hypothetical: 0,
    writes_on_question: {},
    turns_with_verdicts: 0,
    turns_with_ask: 0,
    turns_with_reject: 0,
    turn_ask_rate: null,
    turn_reject_rate: null,
    missed_write: 0,
    not_written_explained: 0,
    tripwire: { matrix: {}, outcomes: {}, benign_suppressed: 0, v1_safety: {} },
    v1_sources: { model: 0, net: 0, unknown: 0 },
  };
  const latencies = [];
  let inTok = 0, cachedTok = 0, outTok = 0, reasonTok = 0, tokRows = 0;

  for (const row of rows) {
    const st = stageAStatusOf(row.finish_reason);
    s.status[st]++;
    if (st === 'skipped') {
      inc(s.skipped, String(row.finish_reason).slice('skipped:'.length) || '?');
    } else {
      s.ran++;
      if (st !== 'parsed') inc(s.errors, String(row.finish_reason ?? 'error'));
      if (typeof row.latency_ms === 'number' && row.latency_ms > 0) {
        latencies.push(row.latency_ms);
        if (row.latency_ms > LIVE_BUDGET_MS) s.latency.over_live_budget++;
      }
      if (typeof row.prompt_tokens === 'number' && row.prompt_tokens > 0) {
        tokRows++;
        inTok += row.prompt_tokens;
        cachedTok += typeof row.cached_tokens === 'number' ? row.cached_tokens : 0;
        outTok += typeof row.completion_tokens === 'number' ? row.completion_tokens : 0;
        reasonTok += typeof row.reasoning_tokens === 'number' ? row.reasoning_tokens : 0;
      }
    }
    for (const f of arr(row.v1_actions)) {
      if (f && !f.dup && f.ok === true) inc(s.v1_sources, f.source === 'model' || f.source === 'net' ? f.source : 'unknown');
    }

    let hasVerdict = false, hasAsk = false, hasReject = false;
    // The turn's intent first (one entry per parsed turn): a question or a hypothetical is A′ —
    // any write v2 would make there is a candidate false write.
    const intent = arr(row.issues).find((e) => e && e.kind === 'intent');
    const questionTurn = !!intent && (intent.primary === 'question' || intent.primary === 'hypothetical' || intent.hypothetical === true);
    if (intent) {
      inc(s.intents, String(intent.primary));
      if (intent.hypothetical === true) s.hypothetical++;
    }
    for (const e of arr(row.issues)) {
      if (!e || typeof e !== 'object') continue;
      if (e.kind === 'verdict') {
        if (questionTurn && (e.outcome === 'commit' || e.outcome === 'flag' || e.outcome === 'ask')) inc(s.writes_on_question, e.op);
        hasVerdict = true;
        s.verdicts.total++;
        const po = (s.verdicts.per_op[e.op] ??= { total: 0, commit: 0, flag: 0, ask: 0, reject: 0 });
        po.total++;
        if (OUTCOMES.includes(e.outcome)) {
          s.verdicts[/** @type {'commit'|'flag'|'ask'|'reject'} */ (e.outcome)]++;
          po[/** @type {'commit'|'flag'|'ask'|'reject'} */ (e.outcome)]++;
        }
        if (e.outcome === 'ask') hasAsk = true;
        if (e.outcome === 'reject') hasReject = true;
      } else if (e.kind === 'issue') {
        if (e.outcome === 'ask' && e.level === 'ask') inc(s.verdicts.ask_codes, `${e.op}:${e.code}`);
        if (e.outcome === 'reject' && e.level === 'hard') inc(s.verdicts.reject_codes, `${e.op}:${e.code}`);
        if (e.level === 'flag') {
          inc(s.verdicts.flag_codes, `${e.op}:${e.code}`);
          if (questionTurn) inc(s.verdicts.flag_codes_on_question, `${e.op}:${e.code}`);
        }
      } else if (e.kind === 'agreement') {
        const o = (s.ops[e.op] ??= { both: 0, v1_only: 0, v2_only: 0, neither: 0, agreement_rate: null });
        if (e.class in o) o[e.class]++;
        if (e.class === 'v1_only') {
          if (e.v1_source === 'net' || e.v1_source === 'mixed') inc(s.net_fired_v2_silent, e.op);
          else inc(s.model_fired_v2_silent, e.op);
        }
        if (e.class === 'v2_only') {
          const v = (s.v2_fired_v1_silent[e.op] ??= { write: 0, ask: 0 });
          if (e.v2 === 'write' || e.v2 === 'ask') v[e.v2]++;
        }
      } else if (e.kind === 'tripwire') {
        const m = (s.tripwire.matrix[e.trigger] ??= { tier: e.tier, positive: 0, benign: 0, missing: 0, 'n/a': 0 });
        if (e.reading in m) m[e.reading]++;
      } else if (e.kind === 'safety') {
        if (e.code === 'tripwire_outcome') inc(s.tripwire.outcomes, String(e.value));
        else if (e.code === 'benign_suppressed') s.tripwire.benign_suppressed++;
        else if (e.code === 'v1_safety') inc(s.tripwire.v1_safety, String(e.value));
      } else if (e.kind === 'envelope' && e.code === 'missed_write') {
        s.missed_write++;
      } else if (e.kind === 'envelope' && e.code === 'not_written_explained') {
        s.not_written_explained++;
      }
    }
    if (hasVerdict) s.turns_with_verdicts++;
    if (hasAsk) s.turns_with_ask++;
    if (hasReject) s.turns_with_reject++;
  }

  for (const o of Object.values(s.ops)) {
    o.agreement_rate = rate(o.both, o.both + o.v1_only + o.v2_only);
  }
  s.parse_error_rate = rate(s.ran - s.status.parsed, s.ran);
  s.latency.n = latencies.length;
  s.latency.p50 = percentile(latencies, 50);
  s.latency.p90 = percentile(latencies, 90);
  if (tokRows > 0) {
    s.tokens.input_avg = Math.round(inTok / tokRows);
    s.tokens.cached_ratio = inTok > 0 ? cachedTok / inTok : null;
    s.tokens.output_avg = Math.round(outTok / tokRows);
    s.tokens.reasoning_avg = Math.round(reasonTok / tokRows);
  }
  s.verdicts.ask_rate = rate(s.verdicts.ask, s.verdicts.total);
  s.verdicts.reject_rate = rate(s.verdicts.reject, s.verdicts.total);
  s.verdicts.top_ask_codes = topN(s.verdicts.ask_codes);
  s.verdicts.top_reject_codes = topN(s.verdicts.reject_codes);
  s.verdicts.top_flag_codes = topN(s.verdicts.flag_codes);
  s.turn_ask_rate = rate(s.turns_with_ask, s.status.parsed);
  s.turn_reject_rate = rate(s.turns_with_reject, s.status.parsed);
  return s;
}

/** @param {number | null | undefined} x */
const pct = (x) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)}%`);
/** @param {number | null | undefined} x */
const ms = (x) => (x === null || x === undefined ? '—' : `${(x / 1000).toFixed(2)} sn`);

/**
 * Plain-text report (Turkish labels, op ids as they are in the registry).
 * @param {ShadowSummary} s
 * @param {{ since?: string, until?: string }} [range]
 */
export function renderShadowReport(s, range = {}) {
  const L = [];
  L.push(`KOCHKO v2 Stage A gölge raporu${range.since ? ` — ${range.since}${range.until ? ` → ${range.until}` : ''}` : ''}`);
  L.push('');
  L.push(`Satır: ${s.rows} · Stage A çalıştı: ${s.ran} · atlandı: ${s.status.skipped}${Object.keys(s.skipped).length ? ` (${Object.entries(s.skipped).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`);
  L.push(`Ayrıştırma/şema hatası: ${pct(s.parse_error_rate)} (kapı ≤ %0,5) · reddedildi ${s.status.refused} · geçersiz ${s.status.invalid} · yarım ${s.status.incomplete} · hata ${s.status.error} · function_call ${s.status.function_call}`);
  for (const [k, v] of topN(s.errors, 8)) L.push(`  ${k}: ${v}`);
  L.push(`Stage A gecikmesi: p50 ${ms(s.latency.p50)} · p90 ${ms(s.latency.p90)} · n=${s.latency.n} · canlı 4 sn bütçesini aşan ${s.latency.over_live_budget}`);
  if (s.tokens.input_avg !== null) {
    L.push(`Token (ort.): girdi ${s.tokens.input_avg} (önbellek ${pct(s.tokens.cached_ratio)}) · çıktı ${s.tokens.output_avg} · düşünme ${s.tokens.reasoning_avg}`);
  }
  L.push('');
  L.push('OP BAŞINA UYUM (v1 uyguladı ↔ v2 yazar/sorardı)');
  const ops = Object.entries(s.ops).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (ops.length === 0) L.push('  (veri yok)');
  for (const [op, o] of ops) {
    L.push(`  ${op.padEnd(22)} uyum ${pct(o.agreement_rate).padStart(6)} · ikisi ${o.both} · yalnız v1 ${o.v1_only} · yalnız v2 ${o.v2_only}${o.neither ? ` · ikisi de değil ${o.neither}` : ''}`);
  }
  L.push('');
  L.push('v1 AĞI TETİKLENDİ, v2 SESSİZ (ağın yakaladığını Stage A kaçırıyor mu?)');
  const nets = topN(s.net_fired_v2_silent, 50);
  if (nets.length === 0) L.push('  yok');
  for (const [op, n] of nets) L.push(`  ${op}: ${n}`);
  const models = topN(s.model_fired_v2_silent, 50);
  if (models.length) {
    L.push('v1 MODELİ YAZDI, v2 SESSİZ');
    for (const [op, n] of models) L.push(`  ${op}: ${n}`);
  }
  L.push('v2 YAZARDI/SORARDI, v1 SESSİZ');
  const v2only = Object.entries(s.v2_fired_v1_silent).sort((a, b) => (b[1].write + b[1].ask) - (a[1].write + a[1].ask));
  if (v2only.length === 0) L.push('  yok');
  for (const [op, v] of v2only) L.push(`  ${op}: yazma ${v.write} · soru ${v.ask}`);
  L.push('');
  L.push(`KARARLAR: ${s.verdicts.total} yazma · commit ${s.verdicts.commit} · flag ${s.verdicts.flag} · ask ${s.verdicts.ask} (${pct(s.verdicts.ask_rate)}) · reject ${s.verdicts.reject} (${pct(s.verdicts.reject_rate)})`);
  L.push(`Tur başına: ask içeren ${pct(s.turn_ask_rate)} · reject içeren ${pct(s.turn_reject_rate)} · kaçırılan kayıt (self_check) ${s.missed_write} · gerekçeyle yazılmayan ${s.not_written_explained}`);
  if (s.verdicts.top_ask_codes.length) L.push(`  en sık ASK: ${s.verdicts.top_ask_codes.map(([c, n]) => `${c} ${n}`).join(' · ')}`);
  if (s.verdicts.top_reject_codes.length) L.push(`  en sık REJECT: ${s.verdicts.top_reject_codes.map(([c, n]) => `${c} ${n}`).join(' · ')}`);
  if (s.verdicts.top_flag_codes.length) L.push(`  en sık FLAG: ${s.verdicts.top_flag_codes.map(([c, n]) => `${c} ${n}`).join(' · ')}`);
  L.push(`Niyet: ${Object.entries(s.intents).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}${s.hypothetical ? ` · varsayım bayraklı ${s.hypothetical}` : ''}`);
  L.push('SORU/VARSAYIM TURUNDA v2 YAZARDI (A′ adayı — elle incelenmeli)');
  const qWrites = topN(s.writes_on_question, 50);
  if (qWrites.length === 0) L.push('  yok');
  for (const [op, n] of qWrites) L.push(`  ${op}: ${n}`);
  const qFlags = topN(s.verdicts.flag_codes_on_question, 50);
  if (qFlags.length) L.push(`  bu turlardaki FLAG: ${qFlags.map(([c, n]) => `${c} ${n}`).join(' · ')}`);
  L.push('');
  L.push('TETİK × OKUMA');
  const tw = Object.entries(s.tripwire.matrix).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (tw.length === 0) L.push('  tetik yok');
  for (const [trigger, m] of tw) {
    L.push(`  ${trigger} [${m.tier}]: pozitif ${m.positive} · benign ${m.benign} · okuma yok ${m.missing} · Stage A yok ${m['n/a']}`);
  }
  L.push(`  §7.2 sonuçları: ${Object.entries(s.tripwire.outcomes).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'} · bastırılan benign ${s.tripwire.benign_suppressed}`);
  if (Object.keys(s.tripwire.v1_safety).length) {
    L.push(`  v1 güvenlik: ${Object.entries(s.tripwire.v1_safety).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  }
  L.push(`v1 uygulanan aksiyon kaynağı: model ${s.v1_sources.model} · ağ ${s.v1_sources.net} · bilinmiyor ${s.v1_sources.unknown}`);
  return L.join('\n');
}
