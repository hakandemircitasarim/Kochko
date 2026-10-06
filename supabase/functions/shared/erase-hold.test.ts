import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  checkConfirmable, parseEraseScope, memoryTombstonePatch, eraseQuestion, eraseDoneLine,
  eraseBlockedLine, eraseLapsedLine, eraseClarifyLine, eraseRequestFailedLine, eraseExecFailedLine,
  pendingEraseNote, ERASE_HOLD_TTL_MIN,
} from './erase-hold.ts';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const live = { expires_at: new Date(NOW + 10 * 60_000).toISOString() };

// ─── the scope is the MODEL's enum — validated, never defaulted ───

Deno.test('Faz0#5: scope accepts only the two enum values (case/space is lossless cleanup)', () => {
  assertEquals(parseEraseScope('account'), 'account');
  assertEquals(parseEraseScope('memory'), 'memory');
  assertEquals(parseEraseScope(' Account '), 'account');
});

Deno.test('Faz0#5: an unknown/missing scope is NOT defaulted to anything (it becomes a question)', () => {
  for (const v of [undefined, null, '', 'hesap', 'all', 'everything', 42, { scope: 'account' }]) {
    assertEquals(parseEraseScope(v), null, `scope ${JSON.stringify(v)} must not be guessed`);
  }
});

// ─── the "NEXT turn only" rule ───

Deno.test('Faz0#5: no hold → nothing can be confirmed (a bare "evet" erases nothing)', () => {
  assertEquals(checkConfirmable(null, 1, NOW), 'none_pending');
});

Deno.test('Faz0#5: the turn right after the question confirms', () => {
  assertEquals(checkConfirmable(live, 1, NOW), null);
});

Deno.test('Faz0#5: a confirm in the SAME turn as the request is blocked (question not even shown)', () => {
  assertEquals(checkConfirmable(live, 0, NOW), 'same_turn');
});

Deno.test('Faz0#5: once another turn passed, the old question can no longer be answered', () => {
  assertEquals(checkConfirmable(live, 2, NOW), 'not_next_turn');
  assertEquals(checkConfirmable(live, 7, NOW), 'not_next_turn');
});

Deno.test('Faz0#5: an expired (or unreadable) hold is never confirmable', () => {
  assertEquals(checkConfirmable({ expires_at: new Date(NOW - 1).toISOString() }, 1, NOW), 'expired');
  assertEquals(checkConfirmable({ expires_at: new Date(NOW).toISOString() }, 1, NOW), 'expired');
  assertEquals(checkConfirmable({ expires_at: 'not-a-date' }, 1, NOW), 'expired');
});

// ─── memory erase is a TOMBSTONE, and it cannot drift from the Settings reset ───

Deno.test('Faz0#5: memory erase stamps the mig-101 tombstone and empties the derived view', () => {
  const p = memoryTombstonePatch('2026-10-05T12:00:00.000Z');
  assertEquals(p.derived_suppressed_at, '2026-10-05T12:00:00.000Z');
  assertEquals(p.general_summary, '');
  assertEquals(p.behavioral_patterns, []);
  assertEquals(p.coaching_notes, '');
  assert(!('user_id' in p), 'the patch never re-keys the row');
});

Deno.test('Faz0#5: chat erase clears EXACTLY what Settings "Tüm Hafızayı Sıfırla" clears', async () => {
  // src/services/privacy.service.ts resetAISummary is the canonical reset (client). The two paths
  // must clear the same columns — a field only one of them clears is memory that "comes back".
  const src = await Deno.readTextFile(new URL('../../../src/services/privacy.service.ts', import.meta.url));
  const start = src.indexOf('export async function resetAISummary');
  assert(start >= 0, 'anchor: resetAISummary moved — update this test with it');
  const body = src.slice(start, src.indexOf('} as never)', start));
  const clientKeys = new Set([...body.matchAll(/^\s+([a-z_]+):/gm)].map((m) => m[1]));
  const edgeKeys = new Set(Object.keys(memoryTombstonePatch('x')));
  assert(clientKeys.size > 10, `anchor parsed too few keys (${clientKeys.size})`);
  assertEquals([...edgeKeys].sort(), [...clientKeys].sort());
});

// ─── the code-owned lines ───

const ALL_LINES = [
  eraseQuestion('account'), eraseQuestion('memory'), eraseDoneLine({ scope: 'account', memoryCleared: true }),
  eraseDoneLine({ scope: 'account', memoryCleared: false }), eraseDoneLine({ scope: 'memory', memoryCleared: true }),
  eraseBlockedLine(), eraseLapsedLine(), eraseClarifyLine(), eraseRequestFailedLine(), eraseExecFailedLine(),
];

Deno.test('Faz0#5: user-facing lines are real Turkish (diacritics) and never the generic apology', () => {
  for (const l of ALL_LINES) {
    assert(/[ıİşŞğĞçÇöÖüÜ]/.test(l), `no diacritics: ${l}`);
    assert(!/bir sorun oldu/i.test(l), `generic failure copy: ${l}`);
  }
});

Deno.test('Faz0#5: the hold question asks exactly ONE question and says nothing was erased yet', () => {
  for (const s of ['account', 'memory'] as const) {
    const q = eraseQuestion(s);
    assertEquals((q.match(/\?/g) ?? []).length, 1, `one question: ${q}`);
    assert(/hiçbir şey silmem/.test(q), 'states that declining erases nothing');
  }
  assert(/30 gün/.test(eraseQuestion('account')), 'account question states the grace window');
  assert(/Hesap ve Güvenlik/.test(eraseQuestion('account')), 'account question names where to withdraw');
});

Deno.test('Faz0#5: the question never suggests an undo phrase the repair net would act on', () => {
  // "iptal et" / "geri al" in a ≤5-word reply trigger the deterministic undo (repair-handler) and
  // would delete the last meal — the question must not teach the user to type them.
  for (const s of ['account', 'memory'] as const) {
    assert(!/iptal et|geri al(?![\p{L}])/u.test(eraseQuestion(s)), eraseQuestion(s));
  }
});

Deno.test('Faz0#5: a failed account tombstone is reported, not hidden behind a success line', () => {
  assert(/sıfırlayamadım/.test(eraseDoneLine({ scope: 'account', memoryCleared: false })));
  assert(!/sıfırlayamadım/.test(eraseDoneLine({ scope: 'account', memoryCleared: true })));
});

Deno.test('Faz0#5: the blocked line states the real window', () => {
  assert(eraseBlockedLine().includes(`${ERASE_HOLD_TTL_MIN} dakika`));
});

Deno.test('Faz0#5: the model is told how to confirm only via the note of the confirmable turn', () => {
  for (const s of ['account', 'memory'] as const) {
    const n = pendingEraseNote(s);
    assert(n.startsWith('BEKLEYEN SILME ONAYI'), 'the prompt rule keys on this heading');
    assert(n.includes('{"type": "data_erase_confirm"}'));
  }
  assert(/hesabinin/.test(pendingEraseNote('account')));
  assert(/hafizasinin/.test(pendingEraseNote('memory')));
});
