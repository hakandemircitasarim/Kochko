/**
 * Client-side input validation
 * Spec 12.6: Saçma giriş kontrolü
 */

/**
 * Check if a numerical input seems suspicious.
 * Returns null if OK, message string if suspicious.
 */
export function checkSuspiciousInput(
  type: 'weight' | 'calories' | 'water' | 'sleep',
  value: number,
  previousValue?: number
): string | null {
  switch (type) {
    case 'weight':
      if (value < 30 || value > 300) return `${value}kg normal aralik disi.`;
      if (previousValue && Math.abs(value - previousValue) / previousValue > 0.10)
        return `${previousValue}kg'dan ${value}kg'a buyuk degisim. Doğru mu?`;
      break;
    case 'calories':
      if (value > 5000) return `${value} kcal cok yuksek. Doğru mu?`;
      break;
    case 'water':
      if (value > 6) return `${value}L cok fazla. Doğru mu?`;
      break;
    case 'sleep':
      if (value > 14 || value < 2) return `${value} saat uyku anormal. Doğru mu?`;
      break;
  }
  return null;
}

/**
 * Validate age for registration (Spec 1.1)
 */
export function validateAge(birthYear: number): { valid: boolean; message: string } {
  const age = new Date().getFullYear() - birthYear;
  if (age < 18) return { valid: false, message: 'Bu uygulama 18 yas ve uzeri icindir.' };
  if (age > 120) return { valid: false, message: 'Gecerli bir dogum yili girin.' };
  return { valid: true, message: '' };
}

/**
 * Detect extreme food portions in text input.
 * Spec 12.6: Sacma giris kontrolu - extreme quantities
 * Returns a Turkish confirmation prompt if extreme portion detected, null otherwise.
 */
const FOOD_WORDS = [
  'yumurta', 'ekmek', 'tabak', 'porsiyon', 'bardak', 'dilim', 'kase',
  'paket', 'kutu', 'sise', 'şişe', 'adet', 'tane', 'kilo', 'litre',
  'kaşık', 'kasik', 'avuc', 'avuç', 'fincan', 'tas', 'tas',
  'pilav', 'makarna', 'et', 'tavuk', 'balik', 'balık', 'peynir',
  'sut', 'süt', 'yogurt', 'yoğurt', 'muz', 'elma', 'portakal',
  'patates', 'pirinc', 'pirinç', 'pizza', 'hamburger', 'lahmacun',
  'pide', 'doner', 'döner', 'kebap', 'kofte', 'köfte',
];

export function checkExtremePortions(text: string): string | null {
  const lower = text.toLocaleLowerCase('tr');

  // Pattern: number (>20) followed by a food word
  const numberPattern = /(\d+)\s*([\wğüşıöçĞÜŞİÖÇ]+)/g;
  let match: RegExpExecArray | null;

  while ((match = numberPattern.exec(lower)) !== null) {
    const quantity = parseInt(match[1], 10);
    const word = match[2];

    if (quantity > 20 && FOOD_WORDS.some(fw => word.includes(fw))) {
      return `${quantity} ${word} girdiniz. Bu miktar cok yuksek gorunuyor. Doğru mu?`;
    }
  }

  return null;
}
