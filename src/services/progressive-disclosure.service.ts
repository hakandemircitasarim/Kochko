/**
 * Progressive Disclosure Service
 * Spec 5.33: Kademeli özellik tanıtımı
 *
 * Tracks which features have been introduced to the user.
 * AI introduces features naturally in conversation flow, not as popups.
 *
 * Timeline:
 * - Day 1: Basic logging + plan viewing
 * - Day 3-5: Contextual features (eating out mode, simulation)
 * - Week 2: Portion calibration, favorite templates, weekly budget
 * - Week 3-4: Challenge, recipe library, report export
 */

export type FeatureKey =
  | 'basic_logging'
  | 'photo_logging'
  | 'plan_viewing'
  | 'eating_out_mode'
  | 'simulation_mode'
  | 'mvd_mode'
  | 'recovery_mode'
  | 'portion_calibration'
  | 'favorite_templates'
  | 'weekly_budget'
  | 'challenge_module'
  | 'recipe_library'
  | 'report_export'
  | 'barcode_scanning'
  | 'strength_tracking'
  | 'if_settings'
  | 'lab_values'
  | 'periodic_state';

interface FeatureIntro {
  key: FeatureKey;
  minDaysAfterSignup: number;
  triggerContext: string; // When AI should naturally introduce this
  introMessage: string;  // What AI says
}

const FEATURE_SCHEDULE: FeatureIntro[] = [
  {
    key: 'photo_logging',
    minDaysAfterSignup: 1,
    triggerContext: 'user mentions food but doesnt describe well',
    introMessage: 'Bu arada, yemeginin fotosunu da atabilirsin - ben analiz edeyim.',
  },
  {
    key: 'eating_out_mode',
    minDaysAfterSignup: 3,
    triggerContext: 'user mentions eating out or restaurant',
    introMessage: 'Disarida yemek yiyeceksen bana soyle, en az hasarli secenekleri onerebilirim.',
  },
  {
    key: 'simulation_mode',
    minDaysAfterSignup: 3,
    triggerContext: 'user asks "can I eat this" or similar',
    introMessage: '"Sunu yesem ne olur?" diye sorabilirsin, sana kalan butceni ve etkisini gostereyim.',
  },
  {
    key: 'portion_calibration',
    minDaysAfterSignup: 7,
    triggerContext: 'user corrects a portion estimate',
    introMessage: 'Porsiyon duzeltmeni kaydettim. Zamanla senin olculerine gore daha dogru tahmin yapacagim.',
  },
  {
    key: 'favorite_templates',
    minDaysAfterSignup: 7,
    triggerContext: 'user logs same meal 3+ times',
    introMessage: 'Bu ogunu sik yiyorsun. Favori sablonlara kaydetmemi ister misin? Tek dokunusla girebilirsin.',
  },
  {
    key: 'weekly_budget',
    minDaysAfterSignup: 10,
    triggerContext: 'user overeats one day',
    introMessage: 'Bugun fazla yedin ama haftalik butcende hala marjin var. Haftalik perspektif daha onemli.',
  },
  {
    key: 'challenge_module',
    minDaysAfterSignup: 21,
    triggerContext: 'user has good streak or asks for motivation',
    introMessage: 'Kendine bir challenge koymak ister misin? 7 gun seker yok, 30 gun 10K adim gibi secenekler var.',
  },
  {
    key: 'strength_tracking',
    minDaysAfterSignup: 14,
    triggerContext: 'user logs strength workout with weights',
    introMessage: 'Agirlik antrenmanini set-rep-kilo olarak kaydedebilirsin. 1RM takibi ve progresyon onerisi yaparim.',
  },
];

/**
 * Get features that should be introduced now based on user's signup date
 * and already-introduced features list.
 */
export function getFeaturesToIntroduce(
  daysSinceSignup: number,
  alreadyIntroduced: string[],
  currentContext: string
): FeatureIntro | null {
  const introduced = new Set(alreadyIntroduced);

  for (const feature of FEATURE_SCHEDULE) {
    if (daysSinceSignup >= feature.minDaysAfterSignup
      && !introduced.has(feature.key)
      && contextMatches(currentContext, feature.triggerContext)) {
      return feature;
    }
  }

  return null;
}

function contextMatches(current: string, trigger: string): boolean {
  // Simplified context matching - in production, AI handles this naturally
  // through the system prompt's progressive disclosure instructions
  return true; // AI decides based on conversation flow
}

/**
 * Calculate days since user signup.
 */
export function daysSinceSignup(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
}
