#!/usr/bin/env node
/**
 * v2-shadow-diff.mjs — the AI_MIMARI_V2 §10 Faz 2 daily shadow report.
 *
 * Reads the Stage A shadow rows (ai_turn_log: pipeline=v2_shadow, stage=understand) through the
 * service-role REST API and prints: per-op v1↔v2 agreement, "v1 net fired but v2 silent" and the
 * reverse, ASK/REJECT rates, parse/schema errors, Stage A latency p50/p90, the tripwire × reading
 * matrix. The aggregation itself is pure and tested (supabase/functions/ai-chat/v2/shadow-report.mjs).
 *
 *   node scripts/v2-shadow-diff.mjs                     # yesterday (UTC)
 *   node scripts/v2-shadow-diff.mjs --since 2026-10-08 --until 2026-10-10
 *   node scripts/v2-shadow-diff.mjs --days 7 --json     # last 7 days, raw summary as JSON
 *
 * Credentials: SUPABASE_SERVICE_ROLE_KEY (required) and SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL in
 * .env). The key is sent only to that Supabase project and never printed. Reads only: no user ids,
 * messages or decisions are selected — the report needs counts and codes, nothing else.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderShadowReport, summarizeShadowRows } from '../supabase/functions/ai-chat/v2/shadow-report.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 1000;
const COLUMNS = [
  'created_at', 'turn_id', 'system_mode', 'model_served', 'latency_ms', 'finish_reason', 'fallback_reason', 'attempts',
  'prompt_tokens', 'completion_tokens', 'reasoning_tokens', 'cached_tokens', 'issues', 'v1_actions',
].join(',');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : '';
}

function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

function shift(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
}

function supabaseUrl() {
  if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL.replace(/\/+$/, '');
  const envFile = join(ROOT, '.env');
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const [k, ...rest] = line.split('=');
      if (k.trim() === 'EXPO_PUBLIC_SUPABASE_URL' && rest.length) return rest.join('=').trim().replace(/\/+$/, '');
    }
  }
  return '';
}

async function fetchRows(base, key, since, until) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const qs = new URLSearchParams({
      select: COLUMNS,
      pipeline: 'eq.v2_shadow',
      stage: 'eq.understand',
      order: 'created_at.asc',
    });
    qs.append('created_at', `gte.${since}T00:00:00Z`);
    qs.append('created_at', `lt.${until}T00:00:00Z`);
    const r = await fetch(`${base}/rest/v1/ai_turn_log?${qs}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${offset}-${offset + PAGE - 1}`, 'Range-Unit': 'items' },
    });
    const text = await r.text();
    if (!r.ok) {
      const missing = text.includes('42703') || text.includes('PGRST204') || (text.includes('column') && text.includes('does not exist'));
      throw new Error(missing
        ? 'ai_turn_log has no v2 columns yet — migration 111_turn_log_v2.sql is not applied, so there are no shadow rows.'
        : `REST ${r.status}: ${text.slice(0, 300)}`);
    }
    const page = JSON.parse(text);
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function main() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const base = supabaseUrl();
  if (!key || !base) {
    console.error('Set SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL in .env).');
    process.exit(2);
  }
  const today = isoDay(new Date());
  const days = Number(arg('days') || 0);
  const since = arg('since') || (days > 0 ? shift(today, -days) : shift(today, -1));
  const until = arg('until') || (days > 0 ? shift(today, 1) : shift(since, 1));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until) || until <= since) {
    console.error('--since / --until must be YYYY-MM-DD with until > since');
    process.exit(2);
  }
  const rows = await fetchRows(base, key, since, until);
  const summary = summarizeShadowRows(rows);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ since, until, summary }, null, 2));
  else console.log(renderShadowReport(summary, { since, until }));
}

main().catch((e) => {
  console.error(`v2-shadow-diff: ${e.message}`);
  process.exit(1);
});
