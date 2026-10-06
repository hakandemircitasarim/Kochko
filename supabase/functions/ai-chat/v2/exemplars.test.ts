/**
 * The exemplar dialogues are the strongest style signal Stage B gets: the model copies them. So the
 * rules the constitution states are pinned here on the examples themselves — an exemplar that asks two
 * questions or claims a write with no receipt would teach exactly the behaviour v2 removes.
 */
import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { BANNED_EMOJI, CLICHES } from '../../shared/voice.ts';
import { COACH_EXEMPLARS, renderExemplars } from './exemplars.ts';
import { diacriticRatio, emojiHits, pileWords, questionCount, shoutedWords } from '../../shared/prompt-lint.ts';
import { estimateTokens, PROMPT_BUDGETS } from './prompt-size.ts';

const RECEIPT_HEADER = 'BU TURDA OLANLAR:';
/** A coach sentence that reports a write. It is only honest when the receipt block shows that write. */
const WRITE_CLAIM = /(?<![\p{L}])(kaydettim|ekledim|düzelttim|sildim|geri aldım|güncelledim|değiştirdim|kurdum|düşürdüm)(?![\p{L}])/iu;

const allExchanges = COACH_EXEMPLARS.flatMap((ex) => ex.exchanges.map((x) => ({ id: ex.id, ...x })));

Deno.test('exemplars: ten dialogues covering the owner-approved themes, unique ids, explicit status', () => {
  assertEquals(COACH_EXEMPLARS.length, 10);
  const ids = COACH_EXEMPLARS.map((e) => e.id);
  assertEquals(new Set(ids).size, ids.length, 'duplicate exemplar id');
  for (
    const theme of [
      'ogun_kaydi', 'kacamak_sonrasi', 'dusuk_motivasyon', 'plato', 'disarida_ciddi_alerji',
      'plan_istegi', 'duzeltme', 'supheli_kayit', 'sakatlik', 'hafif_an',
    ]
  ) assert(ids.includes(theme), `missing theme: ${theme}`);
  for (const ex of COACH_EXEMPLARS) {
    assert(['taslak', 'onaylandi'].includes(ex.status));
    assert(ex.title.trim() && ex.teaches.trim(), `${ex.id}: title/teaches empty`);
    assert(ex.exchanges.length >= 1, `${ex.id}: no exchanges`);
  }
});

Deno.test('exemplars: every exchange shows the receipt block first, like the real facts', () => {
  for (const x of allExchanges) {
    assert(x.facts.length >= 1 && x.facts[0].startsWith(RECEIPT_HEADER), `${x.id}: first fact must be the ${RECEIPT_HEADER} block`);
    assert(x.user.trim().length > 0 && x.coach.trim().length > 0, `${x.id}: empty turn`);
  }
});

Deno.test('exemplars: the coach asks at most one question per reply (the one-question budget)', () => {
  for (const x of allExchanges) {
    assert(questionCount(x.coach) <= 1, `${x.id}: ${questionCount(x.coach)} questions in one reply`);
  }
});

Deno.test('exemplars: a write is claimed only when the receipt block actually shows one (honesty after commit)', () => {
  for (const x of allExchanges) {
    const receipt = x.facts[0];
    const nothingWritten = /kayıt yok/u.test(receipt);
    if (WRITE_CLAIM.test(x.coach)) {
      assert(!nothingWritten, `${x.id}: coach claims a write but the receipt says nothing was written`);
    }
  }
});

Deno.test('exemplars: voice — no emoji, no cliché, no shouting, no lists, full diacritics, concise', () => {
  for (const x of allExchanges) {
    const c = x.coach;
    assertEquals(emojiHits(c), [], `${x.id}: emoji`);
    for (const e of BANNED_EMOJI) assert(!c.includes(e), `${x.id}: banned emoji ${e}`);
    for (const cl of CLICHES) assert(!c.toLocaleLowerCase('tr').includes(cl.toLocaleLowerCase('tr')), `${x.id}: cliché "${cl}"`);
    assertEquals(shoutedWords(c), [], `${x.id}: shouting`);
    assertEquals(pileWords(c), [], `${x.id}: ASLA/MUTLAKA`);
    assert(!/^\s*([-*•]|\d+\.)\s/mu.test(c), `${x.id}: bullet list in a chat reply`);
    assert(diacriticRatio(c) >= 0.04, `${x.id}: looks like ASCII Turkish (diacritic ratio ${diacriticRatio(c).toFixed(3)})`);
    assert(c.length <= 650, `${x.id}: ${c.length} chars — exemplars must model concise replies`);
  }
});

Deno.test('exemplars: the suspicious-record dialogue asks once, then confirms only after the correction receipt', () => {
  const ex = COACH_EXEMPLARS.find((e) => e.id === 'supheli_kayit');
  assert(ex);
  assertEquals(ex.exchanges.length, 2);
  const [ask, fix] = ex.exchanges;
  assert(ask.coach.includes('Bu kayıt yanlış görünüyor, düzelteyim mi?'), 'the owner-approved question must appear verbatim');
  assert(!WRITE_CLAIM.test(ask.coach), 'no correction is claimed before the user agreed');
  assert(/düzeltildi/u.test(fix.facts[0]), 'second turn must carry the correction receipt');
  assert(WRITE_CLAIM.test(fix.coach));
});

Deno.test('exemplars: no user data (no emails, phone-like numbers, ids or links)', () => {
  const blob = JSON.stringify(COACH_EXEMPLARS);
  assert(!blob.includes('@'), 'email-like text');
  assert(!/\d{7,}/u.test(blob), 'phone/id-like digit run');
  assert(!/[0-9a-f]{8}-[0-9a-f]{4}-/iu.test(blob), 'uuid');
  assert(!/https?:/iu.test(blob), 'link');
});

Deno.test('exemplars: rendered section fits its budget and is byte-stable', () => {
  const a = renderExemplars();
  const [floor, ceil] = PROMPT_BUDGETS.exemplars;
  const t = estimateTokens(a);
  assert(t >= floor && t <= ceil, `exemplars ~${t} tokens, budget [${floor}, ${ceil}]`);
  assertEquals(renderExemplars(), a);
  for (const x of allExchanges) {
    assert(a.includes(`Kullanıcı: ${x.user}`) && a.includes(`Koç: ${x.coach}`), `${x.id}: not rendered`);
  }
});

Deno.test('exemplars: docs/KOC_ORNEK_DIYALOGLAR.md is the same text (owner edits there, code mirrors it)', () => {
  const md = Deno.readTextFileSync(new URL('../../../../docs/KOC_ORNEK_DIYALOGLAR.md', import.meta.url));
  COACH_EXEMPLARS.forEach((ex, i) => {
    assert(md.includes(`## ${i + 1}. ${ex.title}`), `md: missing heading "${i + 1}. ${ex.title}"`);
    assert(md.includes(`**Ne öğretiyor:** ${ex.teaches}`), `md: ${ex.id} note differs`);
    for (const x of ex.exchanges) {
      for (const f of x.facts) assert(md.includes(`- ${f}`), `md: ${ex.id} fact differs: ${f}`);
      assert(md.includes(`**Kullanıcı:** ${x.user}`), `md: ${ex.id} user line differs`);
      assert(md.includes(`**Koç:** ${x.coach}`), `md: ${ex.id} coach line differs`);
    }
  });
  const headings = md.match(/^## \d+\. /gmu) ?? [];
  assertEquals(headings.length, COACH_EXEMPLARS.length, 'md has a dialogue the code does not (or vice versa)');
});
