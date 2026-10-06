/**
 * Prompt/reply lint — pure checks on text WE author (prompts, exemplars) or the coach writes.
 *
 * WHY: v1's prompt drifted into ASCII Turkish, capital-letter shouting and ASLA/MUTLAKA piles, and the
 * model copied that register into its replies (map-brain: "the model copies the style of its
 * instructions"). These checks pin the v2 brain prompts in CI (ai-chat/v2/*.test.ts), and the eval
 * harness (AI_MIMARI_V2 §9.4 C: diacritic ratio, ≤ 1 question) can run the same functions on coach
 * replies. It lives in shared/ next to voice.ts because every user-visible prompt (nudge, reports,
 * plan) speaks with the same voice and can be linted the same way.
 *
 * Never apply these to the USER's message: §2 rule 2 keeps regex on user text to the safety
 * tripwires only. Nothing here decides meaning; it only measures style.
 */

/** The v1 shout vocabulary (map-brain: ASLA 20, MUTLAKA 19, SADECE 14, ÖNEMLİ 10, YASAK 7, İHLAL ETME 7, ZORUNLU 6). */
export const SHOUT_WORDS = ['ASLA', 'MUTLAKA', 'SADECE', 'ÖNEMLİ', 'ONEMLI', 'YASAK', 'İHLAL', 'IHLAL', 'ZORUNLU', 'KESİNLİKLE', 'KESINLIKLE', 'DİKKAT', 'DIKKAT'];

/**
 * Words written fully in capitals (3+ letters). `allow` lists block names the facts renderer really
 * uses (e.g. "BU TURDA OLANLAR"); they are names, not emphasis.
 */
export function shoutedWords(text: string, allow: readonly string[] = []): string[] {
  let t = text;
  for (const a of allow) t = t.split(a).join(' ');
  return t.match(/(?<![\p{L}])\p{Lu}{3,}(?![\p{L}])/gu) ?? [];
}

/** The two words that carried v1's "pile" style, in any case. */
export function pileWords(text: string): string[] {
  return text.match(/(?<![\p{L}])(asla|mutlaka)(?![\p{L}])/giu) ?? [];
}

/**
 * Common Turkish words as they look with the diacritics stripped. Their presence means a passage was
 * written (or pasted) in ASCII Turkish, the register v2 removes.
 */
const ASCII_TURKISH = [
  'cok', 'icin', 'degil', 'kullanici', 'yanit', 'ogun', 'soyle', 'gore', 'boyle', 'simdi', 'gun', 'gunluk',
  'ozur', 'oneri', 'onerme', 'kocu', 'koc', 'butce', 'agri', 'saglik', 'uzgun', 'icinde', 'oldugu',
];

export function asciiTurkishHits(text: string): string[] {
  const re = new RegExp(`(?<![\\p{L}])(${ASCII_TURKISH.join('|')})(?![\\p{L}])`, 'giu');
  return text.match(re) ?? [];
}

/** Share of letters that are Turkish-specific (ç ğ ı ö ş ü + capitals). Natural Turkish prose sits around 0.06–0.10. */
export function diacriticRatio(text: string): number {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (letters === 0) return 0;
  const tr = text.match(/[çğıöşüÇĞİÖŞÜ]/g)?.length ?? 0;
  return tr / letters;
}

export function questionCount(text: string): number {
  return text.match(/\?/g)?.length ?? 0;
}

export function emojiHits(text: string): string[] {
  return text.match(/\p{Extended_Pictographic}/gu) ?? [];
}

/** Developer/changelog residue that leaked into v1 prompt strings ("// FIX (audit AI-SYS-04)", "Spec 5.11"…). */
export function devLeakHits(text: string): string[] {
  return text.match(/\/\/|(?<![\p{L}])(FIX|audit|AI-SYS|AI-behaviour|canli-test|Spec \d|T\d\.\d|Katman \d|Layer \d)(?![\p{L}])/gu) ?? [];
}
