/**
 * 0-kcal parse kusuru (canlı, 'kase yoğurt (~0 kcal)') — regresyon ağı.
 *
 * Kök: model kaloriyi boş/0 bırakınca validateMealParse `Number(x)||0` ile SESSİZCE 0'a
 * çeviriyordu ve makro-kurtarma `stated > 0` şartıyla 0'ları atlıyordu. Yenilebilir bir öğe
 * 0 kcal olamaz: makro varsa oradan hesaplanır; yoksa 0 DÜRÜSTÇE kalır (sayı uydurulmaz —
 * ai-chat doğrulama satırı o durumda 'kestiremedim' diye sorar).
 */
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { validateMealParse } from './output-validator.ts';
import { isZeroCaloriePlausible } from './food-reference.ts';

type Item = { name: string; calories: number; protein_g: number; carbs_g: number; fat_g: number };
const itemsOf = (r: ReturnType<typeof validateMealParse>) => (r.corrected as { items: Item[] }).items;

Deno.test('0 kalorili ama makrolu öğe makrolardan kurtarılır (kase yoğurt vakası)', () => {
  const r = validateMealParse({ items: [{ name: 'yoğurt', portion: '1 kase', calories: 0, protein_g: 7, carbs_g: 9.4, fat_g: 6.6 }] });
  const cal = itemsOf(r)[0].calories;
  assertEquals(cal, Math.round(7 * 4 + 9.4 * 4 + 6.6 * 9)); // 125
  assertEquals(r.errors.some(e => e.includes('kalori eksik')), true, 'düzeltme errors listesinde iz bırakır');
});

Deno.test('kalori alanı hiç yokken de makrolardan hesaplanır', () => {
  const r = validateMealParse({ items: [{ name: 'tavuk', portion: '100 g', protein_g: 31, carbs_g: 0, fat_g: 3.6 }] });
  assertEquals(itemsOf(r)[0].calories, Math.round(31 * 4 + 3.6 * 9)); // 156
});

Deno.test('makrosuz 0 kalori 0 KALIR — validator sayı uydurmaz (dürüst bilinmezlik)', () => {
  const r = validateMealParse({ items: [{ name: 'ev yemeği', portion: '1 porsiyon', calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }] });
  assertEquals(itemsOf(r)[0].calories, 0);
});

Deno.test('tutarlı öğe DOKUNULMADAN geçer (mevcut davranış korunur)', () => {
  const r = validateMealParse({ items: [{ name: 'elma', portion: '1 adet', calories: 95, protein_g: 0.5, carbs_g: 25, fat_g: 0.3 }] });
  assertEquals(itemsOf(r)[0].calories, 95);
  assertEquals(r.valid, true);
});

Deno.test('makro-kalori tutarsızlığı düzeltmesi hâlâ çalışıyor (Spec 5.29)', () => {
  // 972-kcal yulaf sınıfı: makrolar 300 kcal'lik, beyan 972 → makrolar kazanır.
  const r = validateMealParse({ items: [{ name: 'yulaf', portion: '40 g', calories: 972, protein_g: 5, carbs_g: 27, fat_g: 3 }] });
  assertEquals(itemsOf(r)[0].calories, Math.round(5 * 4 + 27 * 4 + 3 * 9)); // 155
});

Deno.test('isZeroCaloriePlausible: içecek istisnaları evet, yenilebilirler hayır', () => {
  assertEquals(isZeroCaloriePlausible('su'), true);
  assertEquals(isZeroCaloriePlausible('maden suyu'), true);
  assertEquals(isZeroCaloriePlausible('yeşil çay'), true);
  assertEquals(isZeroCaloriePlausible('kase yoğurt'), false);
  assertEquals(isZeroCaloriePlausible('ev yemeği'), false);
});
