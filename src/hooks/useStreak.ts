import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { calculateStreak, checkMilestones } from '@/services/achievements.service';
import { supabase } from '@/lib/supabase';

export function useStreak() {
  const user = useAuthStore(s => s.user);
  const [streak, setStreak] = useState(0);
  const [newAchievement, setNewAchievement] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    // #R2-L7: pass the user's saved day_boundary_hour instead of the service default (4),
    // so a late-night log is credited to the same calendar day the server used.
    (async () => {
      const { data: prof } = await supabase.from('profiles').select('day_boundary_hour').eq('id', user.id).single();
      const s = await calculateStreak(user.id, (prof?.day_boundary_hour as number | null) ?? 4);
      setStreak(s);
    })();
  }, [user?.id]);

  // Must be memoized: the dashboard lists this in a useCallback dep array that
  // feeds useFocusEffect. An unstable identity here makes the focus effect
  // re-run on every render → setState → re-render → "Maximum update depth
  // exceeded" infinite loop (the whole authed app spins).
  const checkForMilestones = useCallback(async () => {
    if (!user?.id) return;
    // FIX (ux-pass2 #15): profile/firstMetric/goal okumaları birbirinden bağımsız —
    // sıralı şelale yerine paralel çek (calculateStreak yine profile'ı bekler).
    const [{ data: profile }, { data: firstMetric }, { data: goal }] = await Promise.all([
      supabase.from('profiles').select('weight_kg, day_boundary_hour').eq('id', user.id).single(),
      supabase.from('daily_metrics').select('weight_kg').eq('user_id', user.id).order('date').limit(1).single(),
      supabase.from('goals').select('target_weight_kg, goal_type').eq('user_id', user.id).eq('is_active', true).single(),
    ]);
    const s = await calculateStreak(user.id, (profile?.day_boundary_hour as number | null) ?? 4);
    setStreak(s);

    const achievement = await checkMilestones(
      user.id,
      profile?.weight_kg ?? null,
      firstMetric?.weight_kg ?? null,
      goal?.target_weight_kg ?? null,
      s,
      (goal?.goal_type as string | null) ?? null,
    );

    if (achievement) {
      setNewAchievement(achievement.title);
      // Clear after 5 seconds
      setTimeout(() => setNewAchievement(null), 5000);
    }
  }, [user?.id]);

  return { streak, newAchievement, checkForMilestones };
}
