/**
 * TURN FAILURE CLASSES + TYPED GUARD FLAGS (plan v2, F1 · B5).
 *
 * Two defects, one root: the turn's safety and failure OUTCOMES were reconstructed from prose
 * instead of recorded at the moment of decision.
 *
 * 1. THE FALSE AUDIT RECORD. `guard_verdict` was derived by running a regex over the FINAL reply
 *    text. A severe-allergen HARD BLOCK replaces that text wholesale with a fixed safety message
 *    that does not contain the phrases the regex looks for — so the single hardest safety event
 *    the app can produce was written to the ledger as `clean`. Not a missing record: an actively
 *    FALSE one, in the table you would reach for after an incident.
 *
 * 2. THE DEAD-END APOLOGY. Every failed plan turn told the user "bir sorun oldu" — including the
 *    one case where retrying can NEVER work (the generated plan violated a registered allergen).
 *    The user retries, waits, gets the same sentence, and learns the app is broken rather than
 *    that the plan was refused for their safety.
 */

/** What actually happened to a turn that could not deliver. */
export type TurnFailureClass =
  /** The generated content violated a registered allergen and was refused. Retrying cannot help. */
  | 'allergen_violation'
  /** The generated content conflicted with a registered injury and was refused. */
  | 'injury_violation'
  /** The model produced nothing usable (empty/invalid structure). Retrying MAY help. */
  | 'generation_failed'
  /** Generation worked; the write did not. Retrying MAY help. */
  | 'persist_failed'
  /** A quota/cap refused the work. Retrying does not help until the window resets. */
  | 'quota'
  /** Genuinely unknown — the ONLY class allowed to speak in generic terms. */
  | 'unknown';

/**
 * The user-facing sentence per class. Each one answers the only two questions a stuck user has:
 * WHY did it stop, and IS retrying worth my time. Turkish, full diacritics, no apology spiral.
 */
export const FAILURE_LINES: Record<TurnFailureClass, string> = {
  allergen_violation:
    'Hazırladığım plan, profilinde kayıtlı alerjene uygun olmayan bir besin içeriyordu — o yüzden kaydetmedim. Tekrar denemek bunu çözmez; alerjeni çıkarıp yeniden kurmam için "alerjensiz hazırla" de, ya da alerjen kaydın değiştiyse söyle.',
  injury_violation:
    'Hazırladığım programda, kayıtlı sakatlığını zorlayacak hareketler vardı — o yüzden kaydetmedim. "Sakatlık dostu hazırla" dersen o hareketleri çıkarıp yeniden kurarım.',
  generation_failed:
    'Planı bu sefer eksiksiz üretemedim. Bir daha dene — genelde ikinci denemede tamamlanıyor.',
  persist_failed:
    'Planı hazırladım ama kaydederken takıldım. Bir daha dener misin? Hazırladığım şey kaybolmadı.',
  quota:
    'Bugünlük plan hakkın doldu. Yarın yeniden açılıyor; bu arada sohbette konuşmaya devam edebiliriz.',
  unknown:
    'Bunu şu an tamamlayamadım. Bir daha dene; sürerse bana neyi denediğini yaz.',
};

export function failureLine(cls: TurnFailureClass): string {
  return FAILURE_LINES[cls] ?? FAILURE_LINES.unknown;
}

/**
 * A safety/guard decision, recorded WHERE IT IS MADE. Never inferred from the reply afterwards.
 * `allergen_blocked` is the one that did not exist before and could not be produced at all.
 */
export type GuardFlag =
  | 'allergen_blocked'
  | 'allergen_warned'
  | 'injury_warned'
  | 'ed_referral'
  | 'crisis'
  | 'emergency'
  | 'plan_allergen_regen'
  | 'clean';

/**
 * Collapse the flags raised this turn into the single ledger value, worst-first, so a row can be
 * grouped in SQL exactly as before — while `clean` now means "nothing fired", not "the regex
 * didn't recognise what fired".
 */
const SEVERITY_ORDER: GuardFlag[] = [
  'emergency', 'crisis', 'allergen_blocked', 'ed_referral',
  'plan_allergen_regen', 'injury_warned', 'allergen_warned',
];

export function guardVerdictOf(flags: readonly GuardFlag[]): GuardFlag {
  for (const f of SEVERITY_ORDER) if (flags.includes(f)) return f;
  return 'clean';
}
