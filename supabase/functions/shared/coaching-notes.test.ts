import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { formatNote, trimNotes } from './coaching-notes.ts';

Deno.test('A11: the note format carries the date AND the source', () => {
  assertEquals(formatNote('2026-07-26', 'plateau', 'Plateau stratejisi: refeed'),
    '[2026-07-26 · plateau] Plateau stratejisi: refeed');
});

Deno.test('A11: trimming drops the OLDEST lines, never the newest', () => {
  const lines = Array.from({ length: 60 }, (_, i) => `[2026-01-01 · chat] not ${i}`);
  const out = trimNotes(lines.join('\n')).split('\n');
  assert(out.length <= 40, 'bounded');
  assertEquals(out[out.length - 1], 'not 59'.padStart(0) ? lines[59] : lines[59], 'newest survives');
  assert(!out.includes(lines[0]), 'oldest dropped first');
});

Deno.test('A11: a single huge line is never emptied out', () => {
  const big = '[2026-07-26 · chat] ' + 'x'.repeat(6000);
  assertEquals(trimNotes(big), big, 'one line cannot be trimmed away — better long than lost');
});

Deno.test('A11: blank lines are normalised away', () => {
  assertEquals(trimNotes('a\n\n\nb\n'), 'a\nb');
});
