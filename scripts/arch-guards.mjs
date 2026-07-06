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
