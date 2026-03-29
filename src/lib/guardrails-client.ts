/**
 * Client-Side Input Validation — Spec 12.6
 * Validates all numerical inputs before sending to backend.
 * Returns Turkish error messages for user-facing alerts.
 */

/**
 * Check if a numerical input seems suspicious.
 * Returns null if OK, Turkish message string if suspicious.
 */
export function checkSuspiciousInput(
  type: 'weight' | 'calories' | 'water' | 'sleep',
  value: number,
  previousValue?: number,
): string | null {
  switch (type) {
    case 'weight':
      if (value < 20 || value > 350) return `${value} kg gecerli aralik disinda (20-350 kg).`;
      if (previousValue && Math.abs(value - previousValue) / previousValue > 0.10) {
        return `${previousValue} kg'dan ${value} kg'a buyuk bir degisim var. Bu dogru mu?`;
      }
      return null;

    case 'calories':
      if (value < 0) return 'Kalori negatif olamaz.';
      if (value > 5000) return `Tek ogunde ${value} kcal cok yuksek gorunuyor. Dogru mu?`;
      if (value > 3000) return `${value} kcal yuksek bir deger. Emin misin?`;
      return null;

    case 'water':
      if (value < 0) return 'Su miktari negatif olamaz.';
      if (value > 6) return `Tek seferde ${value}L su cok fazla gorunuyor. Dogru mu?`;
      return null;

    case 'sleep':
      if (value > 16) return `${value} saat uyku anormal gorunuyor. Dogru mu?`;
      if (value < 1) return `${value} saat uyku cok az. Dogru mu?`;
      return null;

    default:
      return null;
  }
}

/**
 * Validate age for registration (Spec 1.1).
 * Returns valid:true if age is 18-120, else error message.
 */
export function validateAge(birthYear: number): { valid: boolean; message: string } {
  const currentYear = new Date().getFullYear();
  const age = currentYear - birthYear;

  if (birthYear < 1900 || birthYear > currentYear) {
    return { valid: false, message: 'Gecerli bir dogum yili girin.' };
  }
  if (age < 18) {
    return { valid: false, message: 'Bu uygulama 18 yas ve uzeri icindir.' };
  }
  if (age > 120) {
    return { valid: false, message: 'Gecerli bir dogum yili girin.' };
  }

  return { valid: true, message: '' };
}

/**
 * Validate meal text input before sending to AI.
 * Catches obviously impossible entries.
 */
export function validateMealInput(text: string): { valid: boolean; message: string } {
  const trimmed = text.trim();

  if (!trimmed) return { valid: false, message: 'Ne yedigini yaz.' };
  if (trimmed.length < 2) return { valid: false, message: 'Daha detayli yaz.' };
  if (trimmed.length > 2000) return { valid: false, message: 'Cok uzun, kisalt.' };

  // Check for obviously absurd quantities
  const quantityMatch = trimmed.match(/(\d+)\s*(tane|adet|porsiyon|tabak)/i);
  if (quantityMatch) {
    const qty = parseInt(quantityMatch[1]);
    if (qty > 20) return { valid: false, message: `${qty} ${quantityMatch[2]} cok fazla gorunuyor. Dogru mu?` };
  }

  return { valid: true, message: '' };
}

/**
 * Validate workout text input.
 */
export function validateWorkoutInput(text: string): { valid: boolean; message: string } {
  const trimmed = text.trim();
  if (!trimmed) return { valid: false, message: 'Ne yaptigini yaz.' };
  if (trimmed.length < 2) return { valid: false, message: 'Daha detayli yaz (tur, sure, yogunluk).' };

  // Check for extreme duration
  const durMatch = trimmed.match(/(\d+)\s*(saat|sa|hour|hr)/i);
  if (durMatch) {
    const hours = parseInt(durMatch[1]);
    if (hours > 4) return { valid: false, message: `${hours} saat antrenman cok uzun. Dogru mu?` };
  }

  return { valid: true, message: '' };
}

/**
 * Check if a weight change exceeds safe weekly limits (Spec 12.1).
 * Returns warning if >1.5kg change in a week.
 */
export function checkWeeklyWeightChange(
  currentWeight: number,
  weightOneWeekAgo: number,
): string | null {
  const change = Math.abs(currentWeight - weightOneWeekAgo);
  if (change > 1.5) {
    const direction = currentWeight < weightOneWeekAgo ? 'kayip' : 'artis';
    return `Son 1 haftada ${change.toFixed(1)}kg ${direction} tespit edildi. Bu hizli bir degisim — doktoruna danisman iyi olabilir.`;
  }
  return null;
}

/**
 * Validate supplement input.
 */
export function validateSupplementInput(text: string): { valid: boolean; message: string } {
  if (!text.trim()) return { valid: false, message: 'Takviye adi gir.' };
  return { valid: true, message: '' };
}
