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

Deno.test('constitution v2 (live trial 2026-10-11): the principles each trial defect was traced to', () => {
  const c = COACH_CONSTITUTION;
  // "güncelleyeyim mi?" with no hold behind it: the user's "evet" resolved nothing (mem#2, mem#15-16, final2#14).
  assert(c.includes('Onay sorusu ("kaydedeyim mi?", "güncelleyeyim mi?") yalnızca olgularda bekletilen bir kayıt ya da bekleyen onay varsa sorulur'));
  assert(c.includes('kaydetmediğini açıkça söyle ve ne olduğunu açık uçlu sor'), 'a missed write is said plainly, asked openly');
  // "tartı sonucunu doğru mu yazdım?" with no numbers (final2#11).
  assert(c.includes('olgulardaki sayılarla') && c.includes('soru ona yöneliktir'), 'a held value is asked with its numbers, about what the user wrote');
  // "sistem de bu kaydı belirsiz olarak işaretledi" after the user had confirmed (final2#12).
  assert(c.includes('Onaylanan bir kayıt kesindir'));
  // "bu turdaki kayıtlarda", "düzeltme makbuzu" (mem#16, final2#1), also in the visible "why".
  assert(c.includes('iç sözcükler (tur, makbuz, sistem, kod, bekletme) senin içindir'));
  assert(c.includes('iç sözcük kullanma'), 'the why field is read by the user too');
  assert(!/makbuzlarıdır|makbuz olarak görürsün/u.test(c), 'the constitution itself no longer calls receipts "makbuz" to the model');
  // "telafi etme" in 4 replies of one evening (final2#4, #14, #15).
  assert(c.includes('geçmişteki cevaplarında verdiğin bir tavsiyeyi ya da uyarıyı') && c.includes('kişi telafiden söz etmediyse uyarı olarak açma'));
  // "bacak antrenmanını şimdilik önermem" and nothing else (mem#13).
  assert(c.includes('düz bir ret yerine o bölgeyi yüklemeyen seçenekler öner'));
  // "14 litre su" → a flat 112 command (final2#7); real symptoms keep the plain duty.
  assert(c.includes("112'yi koşullu tek cümleyle an, sayıyı sor") && c.includes("kişiyi hemen 112'yi aramaya"));
});

Deno.test('constitution v3 (re-trial 2026-10-12): the principles each re-trial defect was traced to', () => {
  const c = COACH_CONSTITUTION;
  // final2#17: a wrongly deleted weigh-in was re-written and the coach said it "is there" — own it.
  assert(c.includes('senin hatanı onarıyorsa bunu da söyle') && c.includes('hiç olmamış gibi "yerinde" deme'));
  assert(c.includes('önceki cevabınla çelişirsen bunu an'), 'a silent contradiction of its own earlier claim (final2#13 → #15)');
  // mem#7/#11: the lead-in re-worded the code-owned hold question ("güvenlik filtreleri" twice).
  assert(c.includes('Güvenlik onayının sorusunu kod sona aynen ekler; soruyu da gerekçesini de'));
  // final2#11/#14: the halal + seafood caveat in every food reply.
  assert(c.includes('Kalıcı bir kısıtı (helal, alerji) her öneride hatırlatma') && c.includes('çapraz bulaşma riski varsa söyle'));
  // mem#2/#2c: "zorlanma riski yüksek göründüğü için…" — the tier quoted, the referral paragraph repeated.
  assert(c.includes('Risk düzeyi iç bilgidir, kişiye söyleme'));
  assert(c.includes('olgularda son yönlendirmenin günü varsa yeni bir işaret olmadıkça ve kişi sormadıkça tekrarlama'));
  assert(c.includes('bir uzmana (diyetisyen, psikolog) yönlendirmeyi kendi sesinle'), 'the referral itself stays the coach\'s duty');
  // final2#10: the regen wrote "… deniz ürünü olmadan" into the dish name.
  assert(c.includes('Listedeki ad yalnızca yemeğin ya da hareketin adıdır; çıkardığın malzemeyi adına değil cevaba yaz.'));
});

Deno.test('constitution: the 112 / referral line is code-owned — no claim that the model\'s flag stops it (Faz 3 review)', () => {
  // guarantees.ts judges the line by the TEXT and never reads referral_included (it is only logged):
  // telling the coach the flag prevents a second copy would be a false statement about the code.
  assert(!COACH_CONSTITUTION.includes('referral_included'), 'stale flag mention');
  assert(!COACH_CONSTITUTION.includes('ikinci kez eklenmez'));
  assert(COACH_CONSTITUTION.includes('Kodun eklediği zorunlu satırlar (112, uzman yönlendirmesi, alerjen maruziyeti)'), 'the code-owned lines are still announced');
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
  assertEquals(coachCacheKey('u1'), 'kochko-coach:v3:u1');
  assert(coachCacheKey('u1') !== coachCacheKey('u2'));
});
