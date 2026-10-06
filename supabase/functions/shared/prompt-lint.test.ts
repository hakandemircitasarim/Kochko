/**
 * The lint functions guard the v2 prompts against v1's failure register; if they silently stopped
 * matching (Unicode case, Turkish İ, word boundaries), every prompt test built on them would pass
 * vacuously. These cases pin them, including the v1 strings they exist to catch.
 */
import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { asciiTurkishHits, devLeakHits, diacriticRatio, emojiHits, pileWords, questionCount, shoutedWords } from './prompt-lint.ts';

Deno.test('shoutedWords: catches v1 capitals incl. Turkish letters, allows real block names', () => {
  assertEquals(shoutedWords('Bunu ASLA yapma, ÖNEMLİ ve İHLAL ETME'), ['ASLA', 'ÖNEMLİ', 'İHLAL', 'ETME']);
  assertEquals(shoutedWords('BU TURDA OLANLAR bloğu gerçektir', ['BU TURDA OLANLAR']), []);
  assertEquals(shoutedWords('Kochko, kcal, L, AB'), [], 'mixed case, units and 2-letter acronyms are not shouting');
});

Deno.test('pileWords: ASLA/MUTLAKA in any case, but not inside other words', () => {
  assertEquals(pileWords('asla deme, Mutlaka ekle'), ['asla', 'Mutlaka']);
  assertEquals(pileWords('aslan ve mutlakiyet'), []);
});

Deno.test('asciiTurkishHits: flags stripped diacritics, not the real spelling', () => {
  assertEquals(asciiTurkishHits('Kullanici cok yorgun, ogun icin soyle'), ['Kullanici', 'cok', 'ogun', 'icin', 'soyle']);
  assertEquals(asciiTurkishHits('Kullanıcı çok yorgun, öğün için söyle'), []);
});

Deno.test('diacriticRatio: Turkish prose is well above ASCII Turkish', () => {
  assert(diacriticRatio('Bugün öğle yemeğinde çorba içtin, şimdi akşamı düşünelim.') > 0.1);
  assertEquals(diacriticRatio('Bugun ogle yemeginde corba ictin'), 0);
  assertEquals(diacriticRatio('123 !?'), 0);
});

Deno.test('questionCount / emojiHits', () => {
  assertEquals(questionCount('Nasılsın? Ne yedin?'), 2);
  assertEquals(questionCount('Tamam.'), 0);
  assertEquals(emojiHits('Süper 💪 gidiyorsun 🎉').length, 2);
  assertEquals(emojiHits('~780 kcal · 1,8 L → ⟦m12⟧'), [], 'typographic symbols used in facts are not emoji');
});

Deno.test('devLeakHits: the residue v1 shipped inside prompt strings', () => {
  assert(devLeakHits('// FIX (audit AI-SYS-04): handler bu alani DUZ EZER').length >= 3);
  assert(devLeakHits('CELISKI YONETIMI (Spec 5.11)').length === 1);
  assertEquals(devLeakHits('Bu kayıt yanlış görünüyor, düzelteyim mi?'), []);
});
