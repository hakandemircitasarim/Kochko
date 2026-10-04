import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { judgeTodayWeighIn } from './weigh-in-guard.ts';

const keep = (m: string) => judgeTodayWeighIn(m).keep;

Deno.test('mem#9: the live plateau question is NOT a weigh-in', () => {
  assertEquals(judgeTodayWeighIn('son 3 haftadir kilom hic degismiyor 82.5ta takildim, neden olabilir?'), { keep: false, reason: 'question' });
});

Deno.test('mem#9: question / plateau / past frames without a weigh-in cue are dropped', () => {
  assertEquals(judgeTodayWeighIn('3 haftadır 82de takıldım').reason, 'history');
  assertEquals(judgeTodayWeighIn('kilom günlerdir 82 değişmiyor').reason, 'history');
  assertEquals(judgeTodayWeighIn('geçen hafta 95 kiloydum').reason, 'history');
  assertEquals(judgeTodayWeighIn('82.5 kilo normal mi').reason, 'question');
  assertEquals(keep('sabah 82 kg, neden düşmüyor?'), false);
  assertEquals(keep('tartılmadım ama 82 civarıyım sanırım, neden?'), false);
  // "bugün 12 bin adım" is not a weigh-in number.
  assertEquals(keep('bugün 12 bin adım attım, 3 haftadır 82de takıldım neden?'), false);
});

Deno.test('mem#9: a real weigh-in cue always wins, even with a question', () => {
  assertEquals(judgeTodayWeighIn('82.5 geldim').reason, 'weigh_in_cue');
  assertEquals(keep('85 oldum ama neden bu kadar yavaş?'), true);
  assertEquals(keep('bu sabah 82,4, geçen haftadan yarım kilo düştüm'), true);
  assertEquals(keep('tartıldım 81.2'), true);
  assertEquals(keep('86.5 kiloyum, ne yesem?'), true);
  assertEquals(keep("82'ye düştüm sonunda! neden şimdi?"), true);
  assertEquals(keep('80 kiloya indim, 3 haftadır bekliyordum'), true);
  assertEquals(keep('bugün tartıda 79.8 gördüm, normal mi?'), true);
  assertEquals(keep("bugün 82.5'im, iyi mi?"), true);
});

Deno.test('mem#9: a plain statement stays a weigh-in (unchanged behaviour)', () => {
  assertEquals(judgeTodayWeighIn('82.5').reason, 'plain_statement');
  assertEquals(keep('kilom 82'), true);
  assertEquals(keep('şu an 84 kg'), true);
});
