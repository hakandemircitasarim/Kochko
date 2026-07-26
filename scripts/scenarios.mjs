#!/usr/bin/env node
/**
 * scenarios.mjs — golden scenarios as a DATA TABLE (plan v2, F0 · A0 / E1).
 *
 * The repo's regression history is not "a test broke"; it is "nobody noticed the wire came loose".
 * So these scenarios never assert on the model's WORDING (that is flaky and it drifts). Each one
 * asserts one of two things against LIVE data:
 *   · a DB TRUTH  — a row that must exist, or a row that must not,
 *   · a NEGATIVE TEXT condition — a string that must never appear in what the coach said.
 * Both survive prompt changes, model swaps and rewording. Both are exactly what the 2026-07-25
 * brain audit found: the defects were visible in the data, and nobody was looking.
 *
 *   node scripts/scenarios.mjs              # run every scenario
 *   node scripts/scenarios.mjs --enforced   # only the ones that must already pass (CI-safe)
 *
 * STATUS is a promise, not an excuse:
 *   'enforced' — must pass now; a failure is a regression and exits non-zero.
 *   'pending'  — a known defect from the audit. It is REPORTED, not fatal, and carries the
 *                roadmap step that makes it enforceable. Flipping it to 'enforced' is part of
 *                that step's definition of done, so a step cannot be called finished while its
 *                scenario still fails.
 *
 * Credentials: SUPABASE_ACCESS_TOKEN (management token) in the environment, or scripts/../.sbp.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = readFileSync(join(ROOT, '.env'), 'utf8');
const REF = new URL(/EXPO_PUBLIC_SUPABASE_URL=(\S+)/.exec(env)[1]).hostname.split('.')[0];
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (existsSync(join(ROOT, '.sbp')) ? readFileSync(join(ROOT, '.sbp'), 'utf8').trim() : '');
if (!TOKEN) {
  console.error('Set SUPABASE_ACCESS_TOKEN (a Supabase management token) before running.');
  process.exit(2);
}

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`SQL ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}

/**
 * Each scenario: { id, finding, status, owner, why, query, expect }
 * `query` must return exactly one row with a single column named `n` — the count of VIOLATIONS.
 * `expect` is the maximum tolerated count (almost always 0). Counting violations rather than
 * asserting a shape keeps every scenario readable and makes "how bad is it?" a number.
 */
const SCENARIOS = [
  {
    id: 'S1-object-object',
    finding: 'EYLEM-01 / HAFIZA-03',
    status: 'pending',
    owner: 'F2 · A3a-c',
    why: 'The coach printed a stored OBJECT where a number was expected — the user sees "1 tabak = [object Object]g". Writer writes an object, two readers String() it.',
    corpus: `select count(*)::int as n from chat_messages where role='assistant' and created_at > now() - interval '90 days'`,
    query: `select count(*)::int as n from chat_messages
            where role='assistant' and created_at > now() - interval '90 days'
              and content like '%[object Object]%'`,
    expect: 0,
  },
  {
    id: 'S2-undefined-in-reply',
    finding: 'HAFIZA-04 / EYLEM-09',
    status: 'pending',
    owner: 'F2 · A3a',
    why: 'strength_records is written as {last_weight,last_reps} and read as `1rm`, so the prompt (and sometimes the reply) carries "undefinedkg".',
    corpus: `select count(*)::int as n from chat_messages where role='assistant' and created_at > now() - interval '90 days'`,
    query: `select count(*)::int as n from chat_messages
            where role='assistant' and created_at > now() - interval '90 days'
              and (content ilike '%undefinedkg%' or content ilike '%undefined kg%' or content like '%- undefined:%')`,
    expect: 0,
  },
  {
    id: 'S3-internal-instruction-leak',
    finding: 'EYLEM-05',
    status: 'pending',
    owner: 'F2 · A5',
    why: 'An instruction addressed to the MODEL ("NOT: Dusuk guvenli tahmin — kullanicidan dogrulama iste.") is pushed into the meal receipt and rendered verbatim to the user.',
    corpus: `select count(*)::int as n from chat_messages where created_at > now() - interval '90 days'`,
    query: `select count(*)::int as n from chat_messages
            where created_at > now() - interval '90 days'
              and (content like '%Dusuk guvenli tahmin%' or content like '%Düşük güvenli tahmin — kullanıcıdan%')`,
    expect: 0,
  },
  {
    id: 'S4-zero-data-report',
    finding: 'ÖĞRENME-07',
    // ENFORCED as of F2/A6: the cron no longer writes a row for a day with no data, and the 395
    // rows already poisoning the fleet were backed up to daily_reports_phantom_backup_20260726
    // and removed. A new violation now means the gate regressed.
    status: 'enforced',
    owner: 'F2 · A6',
    why: 'The night cron writes a 0%-compliance report for days the user never opened the app. Those zeros poison the weekly average and trigger a "your plan is too big for you" apology at someone who was simply on holiday.',
    corpus: `select count(*)::int as n from daily_reports where date > current_date - interval '60 days'`,
    // The gate must encode the SAME definition of "has data" the cron uses (meals OR workouts OR
    // metrics, ignoring soft-deleted meals). A looser gate reports phantom violations for days the
    // user really did log a weight or a sleep — which is how a gate loses its credibility.
    query: `select count(*)::int as n
            from daily_reports r
            where r.date > current_date - interval '60 days'
              and coalesce(r.calorie_actual,0) = 0
              and not exists (select 1 from meal_logs m where m.user_id=r.user_id and m.logged_for_date=r.date and m.is_deleted is not true)
              and not exists (select 1 from workout_logs w where w.user_id=r.user_id and w.logged_for_date=r.date)
              and not exists (select 1 from daily_metrics d where d.user_id=r.user_id and d.date=r.date)`,
    expect: 0,
  },
  {
    id: 'S5-allergen-block-logged-clean',
    finding: 'EPİGÜV-06 (B5-LEDGER)',
    // ENFORCED as of the week simulation: Meral's "fıstık ezmeli smoothie" request produced a HARD
    // BLOCK whose ledger row reads allergen_blocked — the first correctly-recorded block ever.
    status: 'enforced',
    owner: 'F1 · B5',
    why: 'The hardest safety event the app has — a severe-allergen HARD BLOCK — is derived by regex over the FINAL text. The block replaces that text, so the turn is recorded as guard_verdict=\'clean\'. Not a missing record: an actively false one.',
    corpus: `select count(*)::int as n from ai_turn_log where created_at > now() - interval '90 days'`,
    // v2 (post-B5): pair each BLOCK MESSAGE with its NEAREST ai-chat turn row and require that
    // row's verdict to be allergen_blocked. The old any-clean-row-within-±2min heuristic
    // false-positived the moment traffic got bursty (the week simulation packs many turns into
    // minutes) — a gate that cries wolf under load teaches people to ignore it.
    query: `select count(*)::int as n
            from chat_messages c
            where c.created_at > now() - interval '90 days'
              and c.role = 'assistant'
              and c.content like '%güvenliğin için o öneriyi göstermiyorum%'
              and coalesce((
                select l.guard_verdict from ai_turn_log l
                where l.user_id = c.user_id and l.function_name = 'ai-chat'
                  and l.created_at between c.created_at - interval '2 minutes' and c.created_at + interval '2 minutes'
                order by abs(extract(epoch from (l.created_at - c.created_at))) asc
                limit 1
              ), 'missing') not in ('allergen_blocked', 'allergen_warned')`,
    expect: 0,
  },
  {
    id: 'S8-merge-array-append',
    finding: 'SEAM-04 (found live, 2026-07-26 emulator drive)',
    status: 'enforced',
    owner: 'F2 · mig 099',
    why: "ai_summary_merge's `array || '{}'` appended one empty object per merge to array-shaped values; 16/18 users carried [{},{},...] in micro_nutrient_risks and the mirror rendered one 'undefined riski' chip per element. Fixed in 099; a violation here means the appender is back.",
    corpus: `select count(*)::int as n from ai_summary`,
    query: `select count(*)::int as n from ai_summary
            where (jsonb_typeof(micro_nutrient_risks::jsonb)='array'
                   and exists (select 1 from jsonb_array_elements(micro_nutrient_risks::jsonb) e where e='{}'::jsonb))
               or (jsonb_typeof(portion_calibration::jsonb)='array'
                   and exists (select 1 from jsonb_array_elements(portion_calibration::jsonb) e where e='{}'::jsonb))
               or (jsonb_typeof(strength_records::jsonb)='array'
                   and exists (select 1 from jsonb_array_elements(strength_records::jsonb) e where e='{}'::jsonb))`,
    expect: 0,
  },
  {
    id: 'S9-kvkk-tombstone-holds',
    finding: 'HAFIZA-06 (C6)',
    status: 'enforced',
    owner: 'F3 · C6 / mig 101',
    why: "A KVKK memory reset promised 'geri alınamaz' and the derived summary regenerated overnight from the same canonical rows. While derived_suppressed_at is set, general_summary and behavioral_patterns must STAY empty — only fresh user input (ai-chat factsDirty) may lift the stamp. This scenario is a standing watch: if any cron regenerates a suppressed user, it goes red.",
    corpus: `select count(*)::int as n from ai_summary`,
    query: `select count(*)::int as n from ai_summary
            where derived_suppressed_at is not null
              and (coalesce(general_summary,'') <> '' or jsonb_array_length(coalesce(behavioral_patterns,'[]'::jsonb)) > 0)`,
    expect: 0,
  },
  {
    id: 'S6-turn-ledger-alive',
    finding: '(gate health)',
    status: 'enforced',
    owner: 'F0 · A00',
    why: 'The whole evidence regime rests on ai_turn_log being written. If the ledger stops, every SQL gate below silently reports "clean" forever. This is the canary for the canaries.',
    query: `select case when count(*) > 0 then 0 else 1 end::int as n
            from ai_turn_log where created_at > now() - interval '30 days'`,
    expect: 0,
  },
  {
    id: 'S7-observability-columns',
    finding: '(gate health)',
    status: 'enforced',
    owner: 'F0 · A00',
    why: 'rollout_stamp and ui_markers are what make "did the new path run?" and "was it actually driven?" answerable. A dropped column would silently disable both gates.',
    query: `select (2 - count(*))::int as n from information_schema.columns
            where table_name='ai_turn_log' and column_name in ('rollout_stamp','ui_markers')`,
    expect: 0,
  },
];

const onlyEnforced = process.argv.includes('--enforced');
const list = onlyEnforced ? SCENARIOS.filter((s) => s.status === 'enforced') : SCENARIOS;

let failed = 0;
let pendingFailing = 0;
let skipped = 0;
console.log(`golden scenarios — ${list.length} scenario(s) against live data\n`);
for (const s of list) {
  let n, err = null, corpus = null;
  try {
    // A scenario that "passes" because there is nothing to look at is a FAKE gate — the exact
    // shape of failure this repo keeps repeating. Prove the corpus first, then judge it.
    if (s.corpus) corpus = (await sql(s.corpus))[0]?.n ?? 0;
    n = (await sql(s.query))[0]?.n ?? 0;
  } catch (e) { err = e.message; }
  if (err == null && corpus === 0) {
    console.log(`  SKIP   ${s.id.padEnd(28)} no corpus to judge (0 rows in window) — NOT a pass`);
    skipped++;
    continue;
  }
  const ok = err == null && n <= s.expect;
  const tag = s.status === 'enforced' ? 'ENFORCED' : `pending → ${s.owner}`;
  if (err) {
    console.log(`  ERROR  ${s.id.padEnd(28)} ${err}`);
    if (s.status === 'enforced') failed++;
  } else if (ok) {
    console.log(`  PASS   ${s.id.padEnd(28)} violations=${n}  [${tag}]`);
  } else {
    console.log(`  FAIL   ${s.id.padEnd(28)} violations=${n} (max ${s.expect})  [${tag}]`);
    console.log(`         ${s.finding}: ${s.why}`);
    if (s.status === 'enforced') failed++; else pendingFailing++;
  }
}
console.log(`\n${failed} enforced failure(s), ${pendingFailing} pending scenario(s) still reproducing.`);
process.exit(failed > 0 ? 1 : 0);
