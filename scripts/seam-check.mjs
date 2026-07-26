#!/usr/bin/env node
/**
 * seam-check.mjs — writer↔reader SYMMETRY at the seams (plan v2, F0 · B6′).
 *
 * arch-guards.mjs guards POINT invariants ("this pattern must never appear again").
 * seam-check guards SET symmetry ("everything written has a reader; everything read has a writer").
 *
 * WHY THIS EXISTS: 23% of the 2026-07-25 brain audit's 83 findings were one class — `inert-wiring`.
 * Code was written and nothing read it, or the writer and reader used different names:
 *   habit vs key · last_weight vs 1rm · pattern vs description · weekly_compliance with zero writers ·
 *   plan_snapshot produced three releases in a row and never rendered in the chat screen.
 * Every one of those was found by a human reading code. That does not scale, and the repo's own
 * history proves it: several were marked "FIXED" in an earlier session and were not wired.
 *
 * HOW: three checkers derive the writer set and the reader set MECHANICALLY from source, then diff.
 * Any asymmetry must be either fixed or DECLARED in seams.manifest.json under `known_gaps` with a
 * finding id and an owner. The count of known gaps is ratcheted by .seam-baseline.json: it may
 * shrink, never grow. Adding a gap entry to make the build green is therefore self-defeating —
 * the ratchet fails first.
 *
 *   node scripts/seam-check.mjs            # check (CI)
 *   node scripts/seam-check.mjs --seed     # write the CURRENT asymmetry into the manifest + baseline
 *   node scripts/seam-check.mjs --relock   # lower the baseline to today's (smaller) count
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const MANIFEST = join(ROOT, 'scripts', 'seams.manifest.json');
const BASELINE = join(ROOT, 'scripts', '.seam-baseline.json');
const read = (p) => readFileSync(p, 'utf8');
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');

function walk(dir, out = [], exts = /\.(ts|tsx)$/) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.expo' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out, exts);
    else if (exts.test(name)) out.push(p);
  }
  return out;
}

const CHAT = join(ROOT, 'supabase', 'functions', 'ai-chat', 'index.ts');
const PROMPT = join(ROOT, 'supabase', 'functions', 'ai-chat', 'system-prompt.ts');
const MODES = join(ROOT, 'supabase', 'functions', 'ai-chat', 'task-modes.ts');
const CLIENT_FILES = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'app'))];

/** Text between two anchors, or '' when either anchor is missing (a moved anchor must FAIL loud). */
function between(text, startRe, endRe, label) {
  const s = text.search(startRe);
  if (s < 0) { anchorFailures.push(`${label}: start anchor not found`); return ''; }
  const rest = text.slice(s);
  const e = rest.search(endRe);
  if (e < 0) { anchorFailures.push(`${label}: end anchor not found`); return ''; }
  return rest.slice(0, e);
}
const anchorFailures = [];

// ─────────────────────────────────────────────────────────────
// CHECKER 1 — action types: what the PROMPT teaches vs what executeActions HANDLES
// ─────────────────────────────────────────────────────────────
function checkActionTypes() {
  const promptFull = read(PROMPT);
  // The layer2_update schema also contains a `"type": "kalip_tipi"` key — that is a PATTERN type,
  // not an action type. Cut that block out or the checker reports a phantom missing handler.
  const l2 = between(promptFull, /## KATMAN 2 GUNCELLEME/, /### YAZIM KURALLARI/, 'layer2 schema (excl)');
  const promptSrc = (l2 ? promptFull.replace(l2, '') : promptFull) + '\n' + read(MODES);
  // Every {"type": "x"} the model is told it may emit.
  const declared = new Set();
  for (const m of promptSrc.matchAll(/"type":\s*"([a-z_]+)"/g)) declared.add(m[1]);

  // Every case handled inside executeActions (8-space indent discriminates it from the
  // 4-space task-completion switch and the 12-space nested strategy switch).
  const chat = read(CHAT);
  const body = between(chat, /async function executeActions\(/, /\nasync function learnMealTime\(/, 'executeActions');
  const handled = new Set();
  for (const m of body.matchAll(/^ {8}case '([a-z_]+)':/gm)) handled.add(m[1]);

  const items = [];
  for (const t of declared) if (!handled.has(t)) items.push({ id: `action:${t}`, side: 'no-handler', detail: `prompt teaches {"type":"${t}"} but executeActions has no case` });
  for (const t of handled) if (!declared.has(t)) items.push({ id: `action:${t}`, side: 'no-teacher', detail: `executeActions handles '${t}' but no prompt teaches it` });
  return { checker: 'action-types', writers: declared.size, readers: handled.size, items };
}

// ─────────────────────────────────────────────────────────────
// CHECKER 2 — layer2_update keys: prompt schema vs processLayer2Updates
// ─────────────────────────────────────────────────────────────
function checkLayer2Keys() {
  const prompt = read(PROMPT);
  const schema = between(prompt, /## KATMAN 2 GUNCELLEME/, /### YAZIM KURALLARI/, 'layer2 schema');
  const declared = new Set();
  for (const m of schema.matchAll(/"([a-z_]+)":/g)) declared.add(m[1]);
  // The schema literal also contains nested value-object keys; those are not top-level updates.
  for (const k of ['type', 'description', 'trigger', 'intervention', 'confidence', 'impact',
    'food', 'user_portion_grams', 'exercise', 'weight_kg', 'reps', 'habit', 'status', 'streak']) declared.delete(k);

  const chat = read(CHAT);
  const body = between(chat, /async function processLayer2Updates\(/, /\nfunction goalCalorieFactor\(/, 'processLayer2Updates');
  const handled = new Set();
  for (const m of body.matchAll(/updates\.([a-z_]+)/g)) handled.add(m[1]);
  for (const m of body.matchAll(/updates\[['"]([a-z_]+)['"]\]/g)) handled.add(m[1]);

  const items = [];
  for (const k of declared) if (!handled.has(k)) items.push({ id: `layer2:${k}`, side: 'no-handler', detail: `prompt teaches layer2_update.${k} but processLayer2Updates never reads it` });
  return { checker: 'layer2-keys', writers: declared.size, readers: handled.size, items };
}

// ─────────────────────────────────────────────────────────────
// CHECKER 3 — response envelope: server fields vs the DECLARED client contract
// ─────────────────────────────────────────────────────────────
function checkEnvelope() {
  const chat = read(CHAT);
  const obj = between(chat, /const responseData = \{/, /\n    \};/, 'responseData');
  const sent = new Set();
  for (const m of obj.matchAll(/^ {6}([a-z_]+):/gm)) sent.add(m[1]);
  // Shorthand properties (`simulation,`) are fields too — missing them made the checker blind to
  // exactly the class it exists to catch.
  for (const m of obj.matchAll(/^ {6}([a-z_]+),\s*$/gm)) sent.add(m[1]);

  // B3: the declaration now lives in the cross-runtime contract — the ONE definition both sides
  // read. The old hand-written client copy is gone (that copy drifting was SEAM-03's cause).
  const contract = read(join(ROOT, 'supabase', 'functions', 'shared', 'contracts', 'turn-envelope.ts'));
  const iface = between(contract, /export interface TurnEnvelope \{/, /\n\}/, 'TurnEnvelope');
  const declared = new Set();
  for (const m of iface.matchAll(/^ {2}([a-z_]+)\??:/gm)) declared.add(m[1]);

  const clientText = CLIENT_FILES.map(read).join('\n');
  const items = [];
  for (const f of sent) {
    if (!declared.has(f)) { items.push({ id: `envelope:${f}`, side: 'undeclared', detail: `ai-chat returns '${f}' but ChatResponse does not declare it` }); continue; }
    // Declared — is it actually consumed anywhere beyond the interface?
    const used = new RegExp(`[.\\[]\\s*['"]?${f}['"]?\\s*[\\]\\s.,;)=?]`).test(clientText.replace(iface, ''));
    if (!used) items.push({ id: `envelope:${f}`, side: 'no-consumer', detail: `ChatResponse.${f} has no consumer in src/ or app/` });
  }
  return { checker: 'envelope-fields', writers: sent.size, readers: declared.size, items };
}

// ─────────────────────────────────────────────────────────────
// CHECKER 4 — the cross-runtime contract boundary stays TYPE-ONLY and import-free
// ─────────────────────────────────────────────────────────────
function checkContractsPurity() {
  const dir = join(ROOT, 'supabase', 'functions', 'shared', 'contracts');
  const files = walk(dir);
  const items = [];
  for (const f of files) {
    const src = read(f);
    const lines = src.split(/\r?\n/);
    lines.forEach((ln, i) => {
      // Runtime exports would force the RN bundler to resolve a path outside src/.
      if (/^\s*export\s+(const|let|var|function|class|enum)\b/.test(ln)) {
        items.push({ id: `contract-purity:${rel(f)}:${i + 1}`, side: 'runtime-export', detail: `${rel(f)}:${i + 1} exports a runtime value — contracts must be type-only` });
      }
      // Any import breaks one of the two typecheckers (remote URL → tsc, .ts extension → Metro).
      if (/^\s*import\s/.test(ln) && !/^\s*import\s+type\s/.test(ln)) {
        items.push({ id: `contract-purity:${rel(f)}:${i + 1}`, side: 'import', detail: `${rel(f)}:${i + 1} has a value import — contracts must be import-free` });
      }
    });
  }
  return { checker: 'contracts-purity', writers: files.length, readers: files.length, items };
}

const CHECKERS = [checkActionTypes, checkLayer2Keys, checkEnvelope, checkContractsPurity];
const results = CHECKERS.map((c) => c());
const found = results.flatMap((r) => r.items);

const manifest = existsSync(MANIFEST) ? JSON.parse(read(MANIFEST)) : { version: 1, note: '', known_gaps: [] };
const baseline = existsSync(BASELINE) ? JSON.parse(read(BASELINE)) : { max_known_gaps: Number.POSITIVE_INFINITY };
const gapIds = new Set((manifest.known_gaps ?? []).map((g) => g.id));

const args = new Set(process.argv.slice(2));

if (args.has('--seed')) {
  manifest.known_gaps = found.map((f) => ({
    id: f.id, side: f.side, detail: f.detail,
    finding: manifest.known_gaps?.find((g) => g.id === f.id)?.finding ?? 'TODO',
    owner: manifest.known_gaps?.find((g) => g.id === f.id)?.owner ?? 'TODO',
  }));
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(BASELINE, JSON.stringify({ max_known_gaps: manifest.known_gaps.length, sealed: 'F0/B6-prime' }, null, 2) + '\n');
  console.log(`seeded ${manifest.known_gaps.length} known gaps into ${rel(MANIFEST)} and locked the ratchet.`);
  process.exit(0);
}

const undeclared = found.filter((f) => !gapIds.has(f.id));
const stale = [...gapIds].filter((id) => !found.some((f) => f.id === id));

for (const r of results) {
  console.log(`  ${r.checker}: ${r.writers} writer / ${r.readers} reader · ${r.items.length} asymmetry`);
}

if (args.has('--relock')) {
  const now = found.filter((f) => gapIds.has(f.id)).length;
  writeFileSync(BASELINE, JSON.stringify({ max_known_gaps: now, sealed: new Date().toISOString().slice(0, 10) }, null, 2) + '\n');
  console.log(`ratchet re-locked at ${now}.`);
  process.exit(0);
}

let bad = false;
if (anchorFailures.length) {
  bad = true;
  console.error('\nANCHOR DRIFT — a checker could not find its source anchor, so its result is meaningless:');
  for (const a of anchorFailures) console.error(`  ✗ ${a}`);
}
if (undeclared.length) {
  bad = true;
  console.error(`\nUNDECLARED SEAM ASYMMETRY (${undeclared.length}) — fix it, or declare it in scripts/seams.manifest.json with a finding id and an owner:`);
  for (const u of undeclared) console.error(`  ✗ [${u.side}] ${u.id} — ${u.detail}`);
}
const current = found.length - undeclared.length;
if (current > (baseline.max_known_gaps ?? Infinity)) {
  bad = true;
  console.error(`\nRATCHET: known gaps ${current} > baseline ${baseline.max_known_gaps}. The debt may shrink, never grow.`);
}
if (stale.length) {
  console.log(`\n${stale.length} declared gap(s) no longer reproduce — remove them from the manifest and run --relock:`);
  for (const s of stale) console.log(`  · ${s}`);
}
if (!bad) console.log(`\nseam-check: OK — ${current} known gap(s), baseline ${baseline.max_known_gaps}.`);
process.exit(bad ? 1 : 0);
