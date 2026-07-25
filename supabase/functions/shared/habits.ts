/**
 * THE habit vocabulary + derived stats (AI-behaviour #14).
 *
 * The habit ladder is the app's central behaviour-change mechanic and it was dead in three
 * independent ways, all verified in source:
 *
 *  1. **A gate that can never fire.** ai-proactive advances to the next habit only when
 *     `streak >= 14 && weekly_compliance >= 80`, but NOTHING in the repository ever WROTE
 *     `weekly_compliance` — it was read in four places and written in zero. So every user was
 *     pinned to habit #1 forever, no matter how consistent they were.
 *  2. **Two vocabularies.** ai-proactive owned a keyed sequence de-duped on `key ?? name`, while the
 *     only chat-side writer (layer2_update.habit_update) used the field `habit`. A chat-created habit
 *     therefore had neither `key` nor `name`, the active-key set became `{undefined}`, and the cron
 *     re-offered "Günlük öğün kaydı" every single morning.
 *  3. **Monotonic streaks.** The only mutation was `streak: streak + 1`, so "12 gün seri" survived a
 *     three-week absence and the coach would cheerfully announce a streak the user had long broken.
 *
 * Fix: ONE catalog, and stats DERIVED from `completion_log` at read time so they cannot lie.
 */

export interface HabitCatalogEntry {
  key: string;
  label: string;
  /** Habit-stacking anchor: the existing routine this one attaches to. */
  anchor: string | null;
}

/** The canonical ladder, in offer order. Was inline in ai-proactive. */
export const HABIT_CATALOG: HabitCatalogEntry[] = [
  { key: 'daily_meal_log', label: 'Günlük öğün kaydı', anchor: null },
  { key: 'water_tracking', label: 'Su takibi', anchor: 'Her öğün kaydından sonra su ekle' },
  { key: 'weight_tracking', label: 'Tartı kaydı (haftada 3x)', anchor: 'Sabah kalktığında tartıl' },
  { key: 'protein_target', label: 'Protein hedefi', anchor: 'Her öğünde proteini kontrol et' },
  { key: 'sleep_tracking', label: 'Uyku kaydı', anchor: 'Sabah kalktığında uyku gir' },
  { key: 'workout_routine', label: 'Antrenman rutini (haftada 3x)', anchor: 'Antrenman günü sabah plan kontrolü' },
];

const LABEL_TO_KEY = new Map(HABIT_CATALOG.map((h) => [h.label.toLocaleLowerCase('tr'), h.key]));

export interface HabitEntry {
  key: string;
  name: string;
  status: string;
  streak: number;
  weekly_compliance?: number;
  completion_log?: string[];
  [k: string]: unknown;
}

/**
 * Map a stored habit row (any generation: {key}, {name}, or the chat writer's {habit}) onto the
 * canonical shape, so cron and chat finally agree on identity.
 */
export function normalizeHabitEntry(raw: unknown): HabitEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const rawName = [o.name, o.habit, o.label, o.key].find((v) => typeof v === 'string' && (v as string).trim()) as string | undefined;
  if (!rawName) return null;
  const explicitKey = typeof o.key === 'string' && o.key.trim() ? o.key.trim() : null;
  const key = explicitKey ?? LABEL_TO_KEY.get(rawName.toLocaleLowerCase('tr')) ?? rawName.toLocaleLowerCase('tr').replace(/\s+/g, '_');
  const catalog = HABIT_CATALOG.find((h) => h.key === key);
  return {
    ...o,
    key,
    name: catalog?.label ?? rawName,
    status: typeof o.status === 'string' ? o.status : 'active',
    streak: Number.isFinite(Number(o.streak)) ? Number(o.streak) : 0,
    weekly_compliance: Number.isFinite(Number(o.weekly_compliance)) ? Number(o.weekly_compliance) : undefined,
    completion_log: Array.isArray(o.completion_log) ? (o.completion_log as unknown[]).filter((d): d is string => typeof d === 'string') : undefined,
  };
}

export interface HabitStats {
  /** Consecutive days done, counting back from today (or yesterday — today may not be over yet). */
  streak: number;
  /** % of the last 7 days done, 0-100. */
  weekly_compliance: number;
  lastDone: string | null;
  /** True when the streak is over but the habit is still active — say it warmly, restart today. */
  broken: boolean;
}

/**
 * Derive habit stats from the completion log. Pure so it is unit-testable and cannot drift between
 * the cron and the chat coach. `today` is the user's effective date ('YYYY-MM-DD').
 */
export function deriveHabitStats(completionLog: string[] | undefined | null, today: string): HabitStats {
  const done = new Set((completionLog ?? []).map((d) => String(d).slice(0, 10)));
  if (done.size === 0) return { streak: 0, weekly_compliance: 0, lastDone: null, broken: false };

  const dayMs = 86400000;
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const dayAt = (offset: number) => new Date(todayMs - offset * dayMs).toISOString().slice(0, 10);

  // Streak: allow today to be pending — start from today if done, else from yesterday, so an
  // unfinished morning doesn't read as a broken streak.
  let streak = 0;
  const start = done.has(dayAt(0)) ? 0 : 1;
  for (let i = start; i < 400; i++) {
    if (done.has(dayAt(i))) streak++;
    else break;
  }

  let last7 = 0;
  for (let i = 0; i < 7; i++) if (done.has(dayAt(i))) last7++;

  const lastDone = [...done].sort().reverse()[0] ?? null;
  const daysSinceLast = lastDone ? Math.round((todayMs - Date.parse(`${lastDone}T00:00:00Z`)) / dayMs) : Infinity;

  return {
    streak,
    weekly_compliance: Math.round((last7 / 7) * 100),
    lastDone,
    broken: streak === 0 && daysSinceLast >= 2 && Number.isFinite(daysSinceLast),
  };
}

/** Is this habit genuinely earned enough to offer the NEXT one? (the previously-impossible gate) */
export function readyForNextHabit(stats: HabitStats): boolean {
  return stats.streak >= 14 && stats.weekly_compliance >= 80;
}
