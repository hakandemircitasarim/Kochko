#!/usr/bin/env node
/**
 * arch-guards.mjs — architecture invariant guards (target-architecture build step 21).
 *
 * Codifies the invariants established in the 2026-07 architecture work so they cannot silently
 * re-rot (this codebase's documented failure mode: the same fact/logic drifting into many copies).
 * Each guard greps the edge source for a REGRESSION of a specific, already-fixed invariant and
 * fails loud. Run in CI or locally:  node scripts/arch-guards.mjs
 *
 * Intentionally grep-based (no build/deps) so it runs anywhere in seconds. Precise over clever:
 * every guard targets a concrete anti-pattern with a known-good allowlist, not a fuzzy heuristic.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const FN_DIR = join(ROOT, 'supabase', 'functions');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|mjs)$/.test(name)) out.push(p);
  }
  return out;
}
const FILES = walk(FN_DIR);
const read = (p) => readFileSync(p, 'utf8');
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');
const linesOf = (txt) => txt.split(/\r?\n/);

const violations = [];
function fail(guard, file, line, msg) { violations.push({ guard, file: rel(file), line, msg }); }

/**
 * G10 (plan v2, F3 · C3) — calorie-band writes go through the target engine. Ten independent
 * writers each re-implemented floor/safety/projection and each missed a different one; ALL
 * DECIDERS are migrated (ai-chat ×5, ai-proactive ×5). The single remaining direct writer is
 * ai-plan's 7-day phase-transition interpolator — a mechanical EXECUTOR of endpoints that were
 * already gated+floored by the engine at decision time (ai-proactive phase advance); running each
 * daily 1/7 step through the engine would add 7 noise ledger rows per transition and re-gate a
 * decision that was already made.
 */
{
  const G10_ALLOW = [
    'shared/target-engine.ts',        // the owner
    'ai-plan/index.ts',               // phase-transition interpolator — executor, endpoints engine-decided
  ];
  for (const f of FILES) {
    const rf = rel(f);
    if (G10_ALLOW.some((a) => rf.endsWith(a))) continue;
    linesOf(read(f)).forEach((ln, i) => {
      if (/calorie_range_rest_min:\s/.test(ln) && !/select|\/\/|null,?$/.test(ln)) {
        fail('G10-target-engine-owner', f, i + 1, 'calorie band written outside target-engine — use applyTargetAdjust()');
      }
    });
  }
}

/**
 * G9 (plan v2, F1 · B2b)/**
 * G9 (plan v2, F1 · B2b) — every executeActions call captures its outcome. A fire-and-forget call
 * on a safety/salvage path meant a failed constraint write was invisible AND unreported — the
 * "coach lies about saving" class at its most dangerous location.
 */
{
  const chat = FILES.find((f) => f.endsWith('ai-chat/index.ts'));
  if (chat) {
    linesOf(read(chat)).forEach((ln, i) => {
      if (/^\s*(await\s+)?executeActions\(/.test(ln) && !/=/.test(ln)) {
        fail('G9-executeActions-captured', chat, i + 1, 'executeActions result discarded — capture and check for failure lines');
      }
    });
  }
}

/**
 * G8 (plan v2, F2 · A11)/**
 * G8 (plan v2, F2 · A11) — coaching_notes is an APPEND-ONLY dated log. updateLayer2 routes to the
 * ai_summary_merge RPC, which REPLACES the column, so a single fresh line there deletes months of
 * observations. Only shared/coaching-notes.ts may write it.
 */
// Two sites are ALLOWLISTED, and the reason matters: both do a genuine read-modify-write with
// their own trimming/dedup semantics (the extractor's 2000-char window, memory.ts's weekly-summary
// replacement). They are appends, not the wipe this guard exists to prevent. Folding them into the
// owner is a follow-up, not a bug fix — and declaring that here beats pretending they don't exist.
const G8_ALLOW = ['ai-extractor/index.ts', 'shared/memory.ts'];
for (const f of FILES) {
  if (f.endsWith('coaching-notes.ts')) continue;
  if (G8_ALLOW.some((a) => rel(f).endsWith(a))) continue;
  const txt = read(f);
  linesOf(txt).forEach((ln, i) => {
    if (/coaching_notes\s*:/.test(ln) && !/select|\/\//.test(ln)) {
      fail('G8-coaching-notes-owner', f, i + 1, 'coaching_notes written directly — use appendCoachingNote()');
    }
  });
}

/**
 * G6 (plan v2, F1 · B5) — the turn's guard verdict must be RECORDED at the decision point, never
 * reverse-engineered from the final reply. The old derivation regexed assistantMessage; a severe
 * allergen HARD BLOCK replaces that text, so the app's gravest safety event was written to the
 * ledger as 'clean' — an actively false audit record. Any regex over the reply that produces a
 * verdict is that bug coming back.
 */
{
  const chat = FILES.find((f) => f.endsWith('ai-chat/index.ts'));
  if (chat) {
    linesOf(read(chat)).forEach((ln, i) => {
      if (/guardVerdict\s*=/.test(ln) && /test\(assistantMessage\)/.test(ln)) {
        fail('G6-guard-verdict-source', chat, i + 1, 'guard_verdict inferred from the reply text — raise a GuardFlag at the decision point instead');
      }
    });
  }
}

/**
 * G7 (plan v2, F1 · B5) — no generic dead-end apology. "bir sorun oldu" told an allergy-blocked
 * user to retry something that can never succeed. Failure copy comes from FAILURE_LINES, keyed by
 * a TurnFailureClass, so every message says why AND whether retrying is worth their time.
 */
for (const f of FILES) {
  if (f.endsWith('turn-failures.ts')) continue;   // the owner of the copy
  if (/\.test\.ts$/.test(f)) continue;            // tests ASSERT the phrase is gone
  linesOf(read(f)).forEach((ln, i) => {
    if (/bir sorun oldu/i.test(ln)) {
      fail('G7-no-generic-failure', f, i + 1, 'generic failure copy — use failureLine(<TurnFailureClass>)');
    }
  });
}

/**
 * G1 — ONE owner for the calorie floor. The male floor is 1500 (clinical-rules.getCalorieFloor);
 * the legacy 1400 must never reappear as an inline floor idiom (`? 1200 : 1400` / `: 1400`).
 */
const FLOOR_IDIOM = /(?:'female'\s*\?\s*1200\s*:\s*1400|1200\s*:\s*1400|gender\s*===\s*'female'\s*\?\s*1200\s*:\s*1400)/;
for (const f of FILES) {
  linesOf(read(f)).forEach((ln, i) => {
    if (FLOOR_IDIOM.test(ln)) fail('G1-floor-owner', f, i + 1, 'inline male floor 1400 — use getCalorieFloor() (owner = 1500)');
  });
}

/** G1b — prompt prose must not paraphrase the stale 1400 male floor. */
const FLOOR_PROSE = /erkek(\s+min)?\s+1400\s*kcal/i;
for (const f of FILES) {
  linesOf(read(f)).forEach((ln, i) => {
    if (FLOOR_PROSE.test(ln)) fail('G1b-floor-prose', f, i + 1, 'prompt says "erkek 1400 kcal" — owner floor is 1500');
  });
}

/** G2 — the clinical-rules owner value itself must remain 1500 (guards the source of truth). */
{
  const cr = FILES.find((f) => f.endsWith('clinical-rules.ts'));
  if (!cr) fail('G2-owner-exists', FN_DIR, 0, 'shared/clinical-rules.ts is missing');
  else {
    const txt = read(cr);
    if (!/male:\s*\{\s*value:\s*1500\b/.test(txt)) fail('G2-male-floor-1500', cr, 0, 'CALORIE_FLOOR.male.value must be 1500 (NICE/EFSA)');
  }
}

/**
 * G3 — the safety spine is the safety source. Any file that reads a LEGACY allergen store
 * (.eq('is_allergen', true)) for a SAFETY decision must also read the typed spine
 * (getActiveConstraints), so coverage is the UNION and can't regress to legacy-only.
 * ai-chat + ai-plan + service-contexts are the safety readers; the food_preferences WRITE path
 * (executeActions food_preference handler) legitimately touches is_allergen without a spine read,
 * so we only assert at the file level: if a file reads is_allergen, it must import getActiveConstraints.
 */
for (const f of FILES) {
  const txt = read(f);
  const readsLegacyAllergen = /\.eq\(\s*['"]is_allergen['"]\s*,\s*true\s*\)/.test(txt);
  const readsSpine = /getActiveConstraints/.test(txt);
  if (readsLegacyAllergen && !readsSpine) {
    fail('G3-spine-union', f, 0, "reads legacy is_allergen for safety but never getActiveConstraints — safety-spine union missing");
  }
}

/**
 * G4 — grounded meal logging. ai-chat must ground logged meals against the food reference
 * (computeItemNutrition), not persist raw model estimates unconditionally.
 */
{
  const chat = FILES.find((f) => f.endsWith(join('ai-chat', 'index.ts')) || /ai-chat[\\/]index\.ts$/.test(f));
  if (chat && !/computeItemNutrition/.test(read(chat))) {
    fail('G4-meal-grounding', chat, 0, 'ai-chat no longer grounds meals via computeItemNutrition (food-reference)');
  }
}

/**
 * G5 — safety effects must not be swallowed silently. A syncConstraint / user_constraints write
 * or a meal_log_items insert wrapped in an EMPTY catch would hide a dropped safety fact. Flag
 * `catch {}` / `catch (e) {}` that sit within ~2 lines of a constraints/meal_log_items write.
 * (Heuristic; deliberately conservative — only flags the empty-body form.)
 */
for (const f of FILES) {
  const lns = linesOf(read(f));
  for (let i = 0; i < lns.length; i++) {
    if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(lns[i])) {
      const ctx = lns.slice(Math.max(0, i - 4), i + 1).join('\n');
      if (/user_constraints|meal_log_items|syncConstraint/.test(ctx)) {
        fail('G5-silent-safety', f, i + 1, 'empty catch adjacent to a safety/integrity write — must fail loud');
      }
    }
  }
}

// ── report ──
if (violations.length === 0) {
  console.log('✓ arch-guards: all invariants hold (' + FILES.length + ' files scanned)');
  process.exit(0);
}
console.error('✗ arch-guards: ' + violations.length + ' invariant violation(s):\n');
for (const v of violations) {
  console.error(`  [${v.guard}] ${v.file}${v.line ? ':' + v.line : ''}\n      ${v.msg}`);
}
console.error('\nEach reflects a re-drifted architecture invariant. Fix or, if intentional, update scripts/arch-guards.mjs.');
process.exit(1);
