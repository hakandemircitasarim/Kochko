/**
 * write-registry/registry.ts — THE list of chat-writable ops, in the order the model reads them.
 *
 * Order matters: it is the order of the anyOf branches in the strict schema and of the sections
 * in the Turkish doc, both of which sit in Stage A's byte-identical cached prefix. Reordering is a
 * schema change → bump SCHEMA_VERSION (registry.test.ts enforces it with a byte snapshot).
 *
 * Coverage (map-writes.json, every chat write path):
 *   meal_log ← meal_log + venue_log · water_log · body_weight ← weight_log (+ profile weight_kg)
 *   sleep_log · mood_log · step_log · workout_log (+ strength_sets) · supplement_log
 *   profile_set ← profile_update (all non-goal/non-spine columns)
 *   goal_set ← profile_update goal_* + goal_suggestion
 *   constraint_add ← food_preference(is_allergen) + health_event + dietary/digestive/hormone columns
 *   constraint_retract ← food_preference clear + health_event_resolve + dietary "none"
 *   constraint_confirm · food_pref ← food_preference (non-allergen) + disliked_foods
 *   life_event · lab_value · recipe_save ← save_recipe · periodic_state ← periodic_state_update
 *   target_change ← maintenance_start / mini_cut_start / plateau_strategy_apply / recovery_plan / mvd_activate
 *   data_erase_request (hold only)
 *   record_ops: record_delete / record_update / record_restore_metric ← handleUndo + correction revert
 *   pending_ops: pending_confirm / pending_discard ← data_erase_confirm + every other hold
 *   commitment_ops: commitment_add ← commitment · commitment_resolve ← the pre-LLM close regex
 *   memory: memory_note ← <layer2_update>
 * plan_action (envelope field) ← <plan_snapshot> intent + user_approved + active_intent.
 */
import type { Channel, RegOp } from './dsl.ts';
import { water_log } from './ops/water.ts';
import { meal_log } from './ops/meal.ts';
import { body_weight, mood_log, sleep_log, step_log } from './ops/metrics.ts';
import { supplement_log, workout_log } from './ops/workout.ts';
import { profile_set } from './ops/profile.ts';
import { goal_set } from './ops/goal.ts';
import { constraint_add, constraint_confirm, constraint_retract, food_pref } from './ops/constraints.ts';
import { lab_value, life_event, recipe_save } from './ops/events.ts';
import { periodic_state, target_change } from './ops/programs.ts';
import { data_erase_request } from './ops/account.ts';
import { record_delete, record_restore_metric, record_update } from './ops/records.ts';
import { commitment_add, commitment_resolve, pending_confirm, pending_discard } from './ops/pending.ts';
import { memory_note } from './ops/memory.ts';

/**
 * Bump on ANY change to the generated schema or doc bytes (field, enum, order, description).
 * It names the strict schema ('kochko_understand_v3') and the cache key, and is stamped on every
 * ai_turn_log row and pending_writes payload (an older hold is never applied blindly).
 *
 * v2 (2026-10-07): Stage A budget — no descriptions in the understand schema (semantics once, in
 * the doc), shared $defs for allergens/body parts, compact doc with rare ops in an appendix;
 * water quantity without a unit-blind range; protective constraint uncertainty is FLAG, not ASK.
 * v3 (2026-10-07): the doc states the `day` vocabulary again (today | yesterday | YYYY-MM-DD,
 * ≤7 days back, no future), generated from the validator's own tokens; the tripwire_reading note
 * names the real block (GÜVENLİK TETİKLERİ, shared/safety-tripwires.ts). Schema bytes unchanged.
 */
export const SCHEMA_VERSION = 'v3';

export const REGISTRY: readonly RegOp[] = [
  // writes[] — what the user reported
  meal_log, water_log, body_weight, sleep_log, mood_log, step_log, workout_log, supplement_log,
  profile_set, goal_set,
  constraint_add, constraint_retract, constraint_confirm, food_pref,
  life_event, lab_value, recipe_save, periodic_state, target_change, data_erase_request,
  // record_ops[] — existing records, by ref
  record_delete, record_update, record_restore_metric,
  // pending_ops[] — answers to holds
  pending_confirm, pending_discard,
  // commitment_ops[]
  commitment_add, commitment_resolve,
  // memory[] — coach stage only
  memory_note,
];

export const CHANNELS: readonly Channel[] = ['writes', 'record_ops', 'pending_ops', 'commitment_ops', 'memory'];

/** Channels that live in the understanding envelope (memory is written by the coach stage). */
export const UNDERSTAND_CHANNELS: readonly Channel[] = ['writes', 'record_ops', 'pending_ops', 'commitment_ops'];

const BY_TYPE = new Map(REGISTRY.map((o) => [o.type, o]));

export function getOp(type: string): RegOp | undefined {
  return BY_TYPE.get(type);
}

export function opsIn(channel: Channel): RegOp[] {
  return REGISTRY.filter((o) => o.channel === channel);
}

/** The op a wire discriminator names inside a channel ('delete' in record_ops). */
export function findWireOp(channel: Channel, wire: unknown): RegOp | undefined {
  return typeof wire === 'string' ? REGISTRY.find((o) => o.channel === channel && o.op === wire) : undefined;
}
