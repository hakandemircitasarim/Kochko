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
    calculateStreak(user.id).then(setStreak);
  }, [user?.id]);

  // Must be memoized: the dashboard lists this in a useCallback dep array that
  // feeds useFocusEffect. An unstable identity here makes the focus effect
  // re-run on every render → setState → re-render → "Maximum update depth
  // exceeded" infinite loop (the whole authed app spins).
  const checkForMilestones = useCallback(async () => {
    if (!user?.id) return;
    const s = await calculateStreak(user.id);
    setStreak(s);

    // Get weight data for milestone check
    const { data: profile } = await supabase.from('profiles').select('weight_kg').eq('id', user.id).single();
    const { data: firstMetric } = await supabase.from('daily_metrics').select('weight_kg').eq('user_id', user.id).order('date').limit(1).single();
    const { data: goal } = await supabase.from('goals').select('target_weight_kg').eq('user_id', user.id).eq('is_active', true).single();

    const achievement = await checkMilestones(
      user.id,
      profile?.weight_kg ?? null,
      firstMetric?.weight_kg ?? null,
      goal?.target_weight_kg ?? null,
      s
    );

    if (achievement) {
      setNewAchievement(achievement.title);
      // Clear after 5 seconds
      setTimeout(() => setNewAchievement(null), 5000);
    }
  }, [user?.id]);

  return { streak, newAchievement, checkForMilestones };
}
