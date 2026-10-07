/**
 * Offline stand-ins for Stage A (`--mode fake --fake <this file>#<export>`). They receive the REAL
 * Stage A request body (production's builder) and answer in ai-decide's shape, so the whole bound
 * pipeline — T2, the request, validateDecision, derive(), receipts, gates — runs with no network
 * and no key. They are baselines, not a model: a fake can never make a gate green on its own merit.
 */
import { sampleDecision } from '../../../shared/write-registry/samples.ts';
import type { FakeAnswer } from './transport.ts';

/** Writes nothing, flags nothing, routes to the coach: the "do nothing" baseline. Most A' pass,
 *  most A and every B+ that needs Stage A fail — a quick end-to-end smoke of the harness. */
export function writesNothing(): FakeAnswer {
  return { decision: sampleDecision() };
}
