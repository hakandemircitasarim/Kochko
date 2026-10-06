/**
 * The constitution replaces a 36K-char prompt whose shouting, ASCII Turkish and record plumbing the
 * model copied into its replies. These tests pin the properties that made v1 fail, so a later edit
 * cannot quietly bring them back: size, register, no record mechanics, the honesty and one-question
 * principles, and a byte-stable cached prefix.
 */
import { assert, assertEquals, assertThrows } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { BANNED_EMOJI, CLICHES } from '../../shared/voice.ts';
import { buildCoachPrefix, COACH_CONSTITUTION, coachCacheKey } from './coach-constitution.ts';
import { renderExemplars } from './exemplars.ts';
import { asciiTurkishHits, devLeakHits, diacriticRatio, emojiHits, pileWords, SHOUT_WORDS, shoutedWords } from '../../shared/prompt-lint.ts';
import { estimateTokens, PROMPT_BUDGETS } from './prompt-size.ts';

/** Block names the facts renderer really uses; written in capitals because they ARE names. */
const BLOCK_NAMES = ['BU TURDA OLANLAR'];

Deno.test('constitution: ~3K tokens (§8.2), not gutted and not regrown into v1', () => {
  const t = estimateTokens(COACH_CONSTITUTION);
  const [floor, ceil] = PROMPT_BUDGETS.constitution;
  assert(t >= floor && t <= ceil, `constitution ~${t} tokens, budget [${floor}, ${ceil}]`);
});

Deno.test('constitution: no shouting, no ASLA/MUTLAKA piles', () => {
  assertEquals(shoutedWords(COACH_CONSTITUTION, BLOCK_NAMES), []);
  assertEquals(pileWords(COACH_CONSTITUTION), []);
  for (const w of SHOUT_WORDS) assert(!COACH_CONSTITUTION.includes(w), `shout word: ${w}`);
});

Deno.test('constitution: written in Turkish with diacritics, not ASCII Turkish', () => {
  assertEquals(asciiTurkishHits(COACH_CONSTITUTION), []);
  const r = diacriticRatio(COACH_CONSTITUTION);
  assert(r >= 0.05, `diacritic ratio ${r.toFixed(3)} — reads like ASCII Turkish`);
});

Deno.test('constitution: no record mechanics and no developer residue (Stage B never writes)', () => {
  assertEquals(devLeakHits(COACH_CONSTITUTION), []);
  const mechanics = /meal_log|water_log|record_ops|profile_update|layer2_update|<actions>|"type"|executeActions/u;
  assert(!mechanics.test(COACH_CONSTITUTION), 'record plumbing leaked into the coach prompt');
  // v1's banned-acknowledgement lists are replaced by ONE principle; they must not come back as lists.
  assert(!/kesin yasak ifadeler/iu.test(COACH_CONSTITUTION));
});

Deno.test('constitution: carries the load-bearing principles', () => {
  const c = COACH_CONSTITUTION;
  assert(c.includes('BU TURDA OLANLAR') && c.includes('o blok senin için gerçektir'), 'honesty-after-commit');
  assert(c.includes('Bir cevapta en fazla bir soru'), 'one-question budget');
  assert(c.includes('en fazla bir kez aç'), 'one unsolicited item');
  assert(c.includes('Bu kayıt yanlış görünüyor, düzelteyim mi?'), 'owner decision: notice a suspicious past record and ask once');
  assert(c.includes("112'yi"), 'emergency duty');
  assert(c.includes('yalnızca sunucunun verdiği sayıları'), 'server numbers only');
  assert(c.includes('emin değilsen sor'), 'honest memory instead of "BİR DAHA UNUTMAZSIN"');
  assert(c.includes('yetenek listesi'), 'promises bounded by the capability list');
});

Deno.test('constitution: names the clichés only once, in the avoid list, and uses no emoji', () => {
  assertEquals(emojiHits(COACH_CONSTITUTION), []);
  for (const e of BANNED_EMOJI) assert(!COACH_CONSTITUTION.includes(e));
  const lower = COACH_CONSTITUTION.toLocaleLowerCase('tr');
  for (const cl of new Set(CLICHES.map((x) => x.toLocaleLowerCase('tr')))) {
    assertEquals(lower.split(cl).length - 1, 1, `cliché "${cl}" must appear exactly once (in the avoid list)`);
  }
});

Deno.test('coach prefix: constitution → exemplars → capabilities, byte-stable', () => {
  const caps = '## Bu uygulamada yapabildiklerin\n- öğün, su, uyku kaydı';
  const a = buildCoachPrefix({ capabilities: caps });
  assertEquals(buildCoachPrefix({ capabilities: caps }), a, 'prefix must be byte-stable to cache');
  const iC = a.indexOf(COACH_CONSTITUTION);
  const iE = a.indexOf(renderExemplars());
  const iK = a.indexOf(caps);
  assert(iC === 0 && iE > iC && iK > iE, 'order is constitution, exemplars, capabilities');
  assertEquals(buildCoachPrefix({ capabilities: `\n${caps}\n  ` }), a, 'surrounding whitespace does not change bytes');
});

Deno.test('coach prefix: refuses an empty capability list instead of letting the coach promise blind', () => {
  assertThrows(() => buildCoachPrefix({ capabilities: '' }));
  assertThrows(() => buildCoachPrefix({ capabilities: '  \n ' }));
});

Deno.test('coach cache key is per user and versioned', () => {
  assertEquals(coachCacheKey('u1'), 'kochko-coach:v1:u1');
  assert(coachCacheKey('u1') !== coachCacheKey('u2'));
});
