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
