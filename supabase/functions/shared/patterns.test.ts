import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { activePatterns, isActivePattern } from './patterns.ts';

/**
 * F2 · A12 — the READ side of forgetting.
 *
 * evolvePatternConfidence marks a pattern 'stale' after 60 silent days and 'resolved' when the user
 * says it no longer applies. Only ONE of four readers honoured that, so a habit resolved months ago
 * kept steering the coach's opening line and kept firing Friday-evening nudges.
 */

Deno.test('resolved and stale patterns are not actionable', () => {
  assertEquals(isActivePattern({ status: 'resolved' }), false);
  assertEquals(isActivePattern({ status: 'stale' }), false);
});

Deno.test('active, candidate and UNSET status remain actionable', () => {
  assertEquals(isActivePattern({ status: 'active' }), true);
  assertEquals(isActivePattern({ status: 'candidate' }), true);
  // Legacy rows written before `status` existed must not silently vanish from the coach's context.
  assertEquals(isActivePattern({}), true);
  assertEquals(isActivePattern({ status: 42 as unknown as string }), true);
});

Deno.test('activePatterns filters a raw array and tolerates null', () => {
  const raw = [
    { type: 'night_eating', status: 'active' },
    { type: 'weekend_deviation', status: 'resolved' },
    { type: 'skip_breakfast', status: 'stale' },
    { type: 'legacy_no_status' },
  ];
  assertEquals(activePatterns(raw).map((p) => p.type), ['night_eating', 'legacy_no_status']);
  assertEquals(activePatterns(null), []);
  assertEquals(activePatterns(undefined), []);
});
