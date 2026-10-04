import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { nudgeTriggerKeys } from './nudge-triggers.ts';

Deno.test('nudgeTriggerKeys: same situation, same key — whatever the detail text says', () => {
  const a = nudgeTriggerKeys('TETIK: PLATEAU - 3 haftadir 85.0kg civarinda durgun');
  const b = nudgeTriggerKeys('TETIK: PLATEAU (dusuk veri) - 2 haftada kilo sabit');
  assertEquals(a, ['plateau']);
  assertEquals(b, ['plateau_dusuk_veri']);
});

Deno.test('nudgeTriggerKeys: no evidence → no keys → no LLM call', () => {
  assertEquals(nudgeTriggerKeys('Saat: 14:00 | Koc tonu: balanced\nSon ogun: 3sa once\nGece riski: yok\n'), []);
});

Deno.test('nudgeTriggerKeys: risk signals and commitments become canonical keys', () => {
  const ctx = 'TETIK: SABAH UYANMA SAATI - Gunaydin\nTAKIP: "aksam yuruyus"\nATISTIRMA RISKI: Saat 22\nGece riski: AKTIF\nMOTIVASYON DUSUSU: %40';
  assertEquals(nudgeTriggerKeys(ctx).sort(), ['atistirma_riski', 'gece_riski', 'motivasyon_dususu', 'sabah_uyanma_saati', 'taahhut_takibi'].sort());
});

Deno.test('nudgeTriggerKeys: em-dash separated labels and Turkish letters fold to ASCII keys', () => {
  assertEquals(nudgeTriggerKeys('TETIK: HAFTALIK BUTCE UYARISI — Haftanin ortasinda'), ['haftalik_butce_uyarisi']);
  assertEquals(nudgeTriggerKeys('TETIK: GEÇİŞ YAKLAŞIYOR - 2 gun'), ['gecis_yaklasiyor']);
});
