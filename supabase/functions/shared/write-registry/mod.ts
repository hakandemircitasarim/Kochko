/**
 * write-registry — public surface (AI_MIMARI_V2 §4). Import from here, not from the op files.
 *
 *   schema:   buildUnderstandSchema / buildFusedSchema / buildReplySchema / strictFormat / SCHEMA_NAMES
 *   doc:      buildWriteDoc / buildMemoryDoc / buildCapabilities;  budget: stageARegistrySize (Stage A prefix size)
 *   validate: validateDecision(decision, ctx) → per-write COMMIT | FLAG | ASK | REJECT (+ plan, safety)
 *   receipts: receiptLine / toActionReceipt / turnFactLine / holdLine / rejectLine
 *   registry: REGISTRY / getOp / opsIn / SCHEMA_VERSION;  refs: parseRef / RenderedRef / REF_KINDS
 */
export { SCHEMA_VERSION, REGISTRY, CHANNELS, UNDERSTAND_CHANNELS, getOp, opsIn, findWireOp } from './registry.ts';
export {
  buildUnderstandSchema, buildFusedSchema, buildReplySchema, strictFormat, schemaBytes, schemaStats, SCHEMA_NAMES,
  type JsonSchema,
} from './schema.ts';
export { buildWriteDoc, buildMemoryDoc } from './doc.ts';
export { approxTokens, stageARegistrySize, STAGE_A_REGISTRY_BUDGET, type RegistryPromptSize } from './budget.ts';
export { buildCapabilities } from './capabilities.ts';
export {
  validateDecision, validateChannelItems, validateConfirmedHold, collectRefs, freezeForHold, opOf,
  type DecisionValidation, type WriteVerdict, type PlanVerdict, type Verdict, type Normalization,
} from './validate.ts';
export {
  receiptLine, toActionReceipt, turnFactLine, holdLine, rejectLine, writeFailedLine, MEAL_LOGGED_MARK,
  type ReceiptCtx,
} from './receipts.ts';
export {
  REF_KINDS, BLOCK_TITLES, BLOCK_REF_KINDS, parseRef, formatRef, DELETABLE_KINDS, PATCH_OPS_BY_TARGET,
  type RefKind, type RefTarget, type RenderedRef, type RenderedRefs,
} from './refs.ts';
export {
  MAX_BACK_DAYS,
  type Channel, type EdTier, type Issue, type IssueLevel, type RegOp, type ValidationContext, type DayTotals, type ReferenceRow,
} from './dsl.ts';
export { UNIT_ML, LIQUID_UNIT_TR, mlPerUnit } from './units.ts';
export * as vocab from './vocab.ts';
export { ENVELOPE_HEAD, ENVELOPE_TAIL, REPLY_HEAD, REPLY_TAIL, INTENT_PRIMARY, ED_CATEGORIES, PLAN_OPS, REPLY_CONTRACTS } from './envelope.ts';
export { ERASE_HOLD_OP } from './ops/pending.ts';
export { PROFILE_FIELD_SPECS, profileFieldLabel } from './ops/profile.ts';
