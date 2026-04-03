/**
 * Notification Intelligence Service
 * Spec 10: Bildirim sistemi — AI önceliklendirme, gruplama, dinamik zamanlama
 *
 * Aynı anda birden fazla bildirim göndermez, önceliklendirip birini seçer.
 * Kullanıcının yanıt kalıplarından zamanlama öğrenir.
 */

// ─── Types ───

export interface NotificationCandidate {
  id: string;
  type: string;
  title: string;
  body: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  scheduledAt: Date;
  category: string;
}

export interface PrioritizedNotification {
  notification: NotificationCandidate;
  score: number;
  bundledWith: string[];
}

// ─── Priority Scoring ───

const PRIORITY_SCORES: Record<string, number> = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25,
};

const TYPE_URGENCY: Record<string, number> = {
  plateau_warning: 90,
  weekly_budget_warning: 85,
  night_snacking_risk: 80,
  commitment_followup: 75,
  meal_reminder: 60,
  water_reminder: 55,
  sport_reminder: 50,
  weighin_reminder: 40,
  reengagement: 35,
  morning_plan: 30,
};

/**
 * Prioritize notifications — select the single most important one.
 * Spec: AI aynı anda birden fazla bildirim göndermez.
 */
export function prioritizeNotifications(
  candidates: NotificationCandidate[]
): PrioritizedNotification | null {
  if (candidates.length === 0) return null;

  // Score each candidate
  const scored = candidates.map(c => ({
    notification: c,
    score: calculateScore(c),
    bundledWith: [] as string[],
  }));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Winner takes all, but bundle similar-time notifications
  const winner = scored[0];

  // Find notifications within 30 minutes that can be bundled
  const bundleable = scored.slice(1).filter(s => {
    const timeDiff = Math.abs(s.notification.scheduledAt.getTime() - winner.notification.scheduledAt.getTime());
    return timeDiff < 30 * 60 * 1000; // 30 minutes
  });

  if (bundleable.length > 0) {
    winner.bundledWith = bundleable.map(b => b.notification.type);

    // Modify body to include bundled info
    const bundleNotes = bundleable
      .slice(0, 2) // max 2 bundled items
      .map(b => b.notification.title)
      .join(' + ');
    winner.notification.body += ` (+ ${bundleNotes})`;
  }

  return winner;
}

function calculateScore(notification: NotificationCandidate): number {
  const priorityScore = PRIORITY_SCORES[notification.priority] ?? 50;
  const typeScore = TYPE_URGENCY[notification.type] ?? 40;

  // Time relevance — notifications closer to now score higher
  const now = Date.now();
  const timeDiff = Math.abs(notification.scheduledAt.getTime() - now);
  const timeBonus = Math.max(0, 20 - (timeDiff / (60 * 1000))); // 0-20 bonus for proximity

  return priorityScore * 0.4 + typeScore * 0.4 + timeBonus * 0.2;
}

// ─── Intelligent Bundling ───

/**
 * Bundle multiple notifications into a single summary notification.
 */
export function bundleNotifications(
  candidates: NotificationCandidate[]
): NotificationCandidate | null {
  if (candidates.length <= 1) return candidates[0] ?? null;

  // Group by time window (30 min)
  const sorted = [...candidates].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  const groups: NotificationCandidate[][] = [];
  let currentGroup: NotificationCandidate[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const timeDiff = sorted[i].scheduledAt.getTime() - currentGroup[0].scheduledAt.getTime();
    if (timeDiff < 30 * 60 * 1000) {
      currentGroup.push(sorted[i]);
    } else {
      groups.push(currentGroup);
      currentGroup = [sorted[i]];
    }
  }
  groups.push(currentGroup);

  // For each group with 2+ items, create a bundled notification
  const largestGroup = groups.sort((a, b) => b.length - a.length)[0];
  if (largestGroup.length < 2) return largestGroup[0];

  const highestPriority = largestGroup.reduce((best, n) =>
    (PRIORITY_SCORES[n.priority] ?? 0) > (PRIORITY_SCORES[best.priority] ?? 0) ? n : best
  );

  return {
    id: `bundle_${Date.now()}`,
    type: 'bundled',
    title: 'Kochko Hatirlatma',
    body: largestGroup.map(n => n.title).join(' | '),
    priority: highestPriority.priority,
    scheduledAt: highestPriority.scheduledAt,
    category: 'bundled',
  };
}

// ─── Dynamic Timing ───

/**
 * Calculate optimal notification time based on user's response patterns.
 * Returns adjusted time that user is most likely to respond.
 */
export function calculateDynamicTiming(
  originalTime: Date,
  userResponseHours: number[] // hours when user typically responds (e.g., [8, 12, 19])
): Date {
  if (userResponseHours.length === 0) return originalTime;

  const originalHour = originalTime.getHours();

  // Find the closest active hour
  let closestHour = userResponseHours[0];
  let minDiff = Math.abs(originalHour - closestHour);

  for (const hour of userResponseHours) {
    const diff = Math.abs(originalHour - hour);
    if (diff < minDiff) {
      minDiff = diff;
      closestHour = hour;
    }
  }

  // Only adjust if within 2 hours of an active time
  if (minDiff <= 2) {
    const adjusted = new Date(originalTime);
    adjusted.setHours(closestHour, 0, 0, 0);
    return adjusted;
  }

  return originalTime;
}

/**
 * Get user's typical active hours from chat history.
 */
export function inferActiveHours(
  chatTimestamps: string[]
): number[] {
  if (chatTimestamps.length < 10) return [8, 12, 19]; // defaults

  const hourCounts: Record<number, number> = {};
  for (const ts of chatTimestamps) {
    const hour = new Date(ts).getHours();
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
  }

  // Get top 3-5 most active hours
  return Object.entries(hourCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([hour]) => parseInt(hour))
    .sort((a, b) => a - b);
}
