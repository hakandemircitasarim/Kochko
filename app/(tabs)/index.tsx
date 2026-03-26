import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { CoachingBanner } from '@/components/coaching/CoachingBanner';
import { COLORS, SPACING, FONT_SIZE, WATER_INCREMENT } from '@/lib/constants';

interface MealEntry {
  id: string;
  raw_input: string;
  meal_type: string;
  logged_at: string;
  calories: number;
  protein_g: number;
}

interface WorkoutEntry {
  id: string;
  raw_input: string;
  duration_min: number;
  logged_at: string;
}

interface TodayData {
  meals: MealEntry[];
  workouts: WorkoutEntry[];
  weight_kg: number | null;
  water_liters: number;
  sleep_hours: number | null;
  steps: number | null;
  mood_note: string | null;
}

const mealTypeLabels: Record<string, string> = {
  breakfast: 'Kahvaltı',
  lunch: 'Öğle',
  dinner: 'Akşam',
  snack: 'Ara',
};

export default function TodayScreen() {
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<TodayData>({
    meals: [], workouts: [], weight_kg: null,
    water_liters: 0, sleep_hours: null, steps: null, mood_note: null,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [quickInput, setQuickInput] = useState('');
  const [quickLoading, setQuickLoading] = useState(false);

  const today = new Date().toISOString().split('T')[0];

  const loadData = useCallback(async () => {
    if (!user?.id) return;

    const [mealsRes, workoutsRes, metricsRes] = await Promise.all([
      supabase
        .from('meal_logs')
        .select('id, raw_input, meal_type, logged_at')
        .eq('user_id', user.id)
        .gte('logged_at', `${today}T00:00:00`)
        .lte('logged_at', `${today}T23:59:59`)
        .order('logged_at'),
      supabase
        .from('workout_logs')
        .select('id, raw_input, duration_min, logged_at')
        .eq('user_id', user.id)
        .gte('logged_at', `${today}T00:00:00`)
        .lte('logged_at', `${today}T23:59:59`)
        .order('logged_at'),
      supabase
        .from('daily_metrics')
        .select('*')
        .eq('user_id', user.id)
        .eq('date', today)
        .single(),
    ]);

    // Get calories for meals
    const meals: MealEntry[] = [];
    for (const meal of (mealsRes.data ?? [])) {
      const { data: items } = await supabase
        .from('meal_log_items')
        .select('calories, protein_g')
        .eq('meal_log_id', (meal as { id: string }).id);
      const totalCal = (items ?? []).reduce((s: number, i: { calories: number }) => s + i.calories, 0);
      const totalPro = (items ?? []).reduce((s: number, i: { protein_g: number }) => s + i.protein_g, 0);
      meals.push({
        ...(meal as { id: string; raw_input: string; meal_type: string; logged_at: string }),
        calories: totalCal,
        protein_g: totalPro,
      });
    }

    setData({
      meals,
      workouts: (workoutsRes.data as WorkoutEntry[]) ?? [],
      weight_kg: metricsRes.data?.weight_kg ?? null,
      water_liters: metricsRes.data?.water_liters ?? 0,
      sleep_hours: metricsRes.data?.sleep_hours ?? null,
      steps: metricsRes.data?.steps ?? null,
      mood_note: metricsRes.data?.mood_note ?? null,
    });
  }, [user?.id, today]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const addWater = async () => {
    if (!user?.id) return;
    const newAmount = data.water_liters + WATER_INCREMENT;
    await supabase.from('daily_metrics').upsert({
      user_id: user.id, date: today,
      water_liters: newAmount, synced: true,
    }, { onConflict: 'user_id,date' });
    setData((prev) => ({ ...prev, water_liters: newAmount }));
  };

  const deleteMeal = async (id: string) => {
    Alert.alert('Sil', 'Bu kaydı silmek istediğine emin misin?', [
      { text: 'İptal', style: 'cancel' },
      {
        text: 'Sil', style: 'destructive',
        onPress: async () => {
          await supabase.from('meal_log_items').delete().eq('meal_log_id', id);
          await supabase.from('meal_logs').delete().eq('id', id);
          setData((prev) => ({ ...prev, meals: prev.meals.filter((m) => m.id !== id) }));
        },
      },
    ]);
  };

  const deleteWorkout = async (id: string) => {
    Alert.alert('Sil', 'Bu kaydı silmek istediğine emin misin?', [
      { text: 'İptal', style: 'cancel' },
      {
        text: 'Sil', style: 'destructive',
        onPress: async () => {
          await supabase.from('workout_logs').delete().eq('id', id);
          setData((prev) => ({ ...prev, workouts: prev.workouts.filter((w) => w.id !== id) }));
        },
      },
    ]);
  };

  // Quick add via chat - sends to AI coach
  const handleQuickAdd = async () => {
    if (!quickInput.trim()) return;
    setQuickLoading(true);
    // Navigate to chat with pre-filled message
    router.push({ pathname: '/(tabs)/chat', params: { prefill: quickInput.trim() } });
    setQuickInput('');
    setQuickLoading(false);
  };

  const totalCalories = data.meals.reduce((s, m) => s + m.calories, 0);
  const totalProtein = data.meals.reduce((s, m) => s + m.protein_g, 0);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
    >
      <Text style={styles.greeting}>Bugün</Text>
      <Text style={styles.date}>
        {new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })}
      </Text>

      <CoachingBanner />

      {/* Quick Input - talk to your coach */}
      <View style={styles.quickInputRow}>
        <Input
          placeholder="Koçuna yaz... (yedim, yaptım, sorularım...)"
          value={quickInput}
          onChangeText={setQuickInput}
          style={styles.quickInputField}
        />
        <Button title="Gonder" size="sm" onPress={handleQuickAdd} loading={quickLoading} />
      </View>

      {/* Summary Stats */}
      <View style={styles.statsRow}>
        <StatBox value={`${totalCalories}`} label="kcal" />
        <StatBox value={`${Math.round(totalProtein)}g`} label="protein" />
        <StatBox value={`${data.water_liters.toFixed(1)}L`} label="su" onPress={addWater} pressLabel="+Su" />
        <StatBox value={data.weight_kg ? `${data.weight_kg}` : '-'} label="kg" />
      </View>

      {/* Quick Actions */}
      <View style={styles.quickActions}>
        <QuickAction label="Ogun" icon="+" onPress={() => router.push('/log/meal')} />
        <QuickAction label="Spor" icon="+" onPress={() => router.push('/log/workout')} />
        <QuickAction label="Tarti" icon="+" onPress={() => router.push('/log/weight')} />
        <QuickAction label="Foto" icon="+" onPress={() => router.push('/(tabs)/chat')} />
      </View>

      {/* Meals List - Editable */}
      <Card title={`Ogunler (${data.meals.length})`}>
        {data.meals.length === 0 ? (
          <Text style={styles.emptyText}>
            Henuz kayit yok. Kocuna yaz veya manuel ekle.
          </Text>
        ) : (
          data.meals.map((meal) => (
            <TouchableOpacity
              key={meal.id}
              style={styles.listItem}
              onLongPress={() => deleteMeal(meal.id)}
            >
              <View style={styles.listItemLeft}>
                <Text style={styles.mealType}>{mealTypeLabels[meal.meal_type] ?? meal.meal_type}</Text>
                <Text style={styles.mealText}>{meal.raw_input}</Text>
              </View>
              <View style={styles.listItemRight}>
                <Text style={styles.mealCal}>{meal.calories} kcal</Text>
                <Text style={styles.mealPro}>{Math.round(meal.protein_g)}g pro</Text>
              </View>
              <Text style={styles.mealTime}>
                {new Date(meal.logged_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </Card>

      {/* Workouts List - Editable */}
      <Card title={`Antrenmanlar (${data.workouts.length})`}>
        {data.workouts.length === 0 ? (
          <Text style={styles.emptyText}>
            Henuz antrenman yok.
          </Text>
        ) : (
          data.workouts.map((w) => (
            <TouchableOpacity
              key={w.id}
              style={styles.listItem}
              onLongPress={() => deleteWorkout(w.id)}
            >
              <View style={styles.listItemLeft}>
                <Text style={styles.mealText}>{w.raw_input}</Text>
              </View>
              <Text style={styles.mealTime}>
                {w.duration_min > 0 ? `${w.duration_min} dk` : ''}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </Card>

      {/* Report Links */}
      <View style={styles.reportLinks}>
        <TouchableOpacity style={styles.reportLink} onPress={() => router.push('/reports/daily')}>
          <Text style={styles.reportLinkText}>Gun Sonu Raporu</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.reportLink} onPress={() => router.push('/reports/weekly')}>
          <Text style={styles.reportLinkText}>Haftalik Rapor</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.hint}>Uzun bas: kaydi sil</Text>
    </ScrollView>
  );
}

function StatBox({ value, label, onPress, pressLabel }: {
  value: string; label: string; onPress?: () => void; pressLabel?: string;
}) {
  return (
    <TouchableOpacity style={styles.statBox} onPress={onPress} disabled={!onPress}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{onPress ? pressLabel ?? label : label}</Text>
    </TouchableOpacity>
  );
}

function QuickAction({ label, icon, onPress }: { label: string; icon: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.quickAction} onPress={onPress}>
      <Text style={styles.quickActionIcon}>{icon}</Text>
      <Text style={styles.quickActionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  greeting: { fontSize: FONT_SIZE.xxl, fontWeight: '800', color: COLORS.text },
  date: { fontSize: FONT_SIZE.md, color: COLORS.textSecondary, marginBottom: SPACING.md },

  quickInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: SPACING.sm, marginBottom: SPACING.md },
  quickInputField: { flex: 1, marginBottom: 0 },

  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.md },
  statBox: {
    backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md,
    alignItems: 'center', flex: 1, marginHorizontal: 3,
    borderWidth: 1, borderColor: COLORS.border,
  },
  statValue: { fontSize: FONT_SIZE.xl, fontWeight: '700', color: COLORS.primary },
  statLabel: { fontSize: FONT_SIZE.xs, color: COLORS.textSecondary, marginTop: 2 },

  quickActions: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: SPACING.lg },
  quickAction: { alignItems: 'center', padding: SPACING.sm },
  quickActionIcon: { fontSize: 24, color: COLORS.primary, fontWeight: '700' },
  quickActionLabel: { fontSize: FONT_SIZE.xs, color: COLORS.textSecondary, marginTop: 2 },

  listItem: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm,
    borderBottomWidth: 1, borderBottomColor: COLORS.border, gap: SPACING.sm,
  },
  listItemLeft: { flex: 1 },
  listItemRight: { alignItems: 'flex-end' },
  mealType: { color: COLORS.primary, fontSize: FONT_SIZE.xs, fontWeight: '600', textTransform: 'uppercase' },
  mealText: { color: COLORS.text, fontSize: FONT_SIZE.md, marginTop: 2 },
  mealCal: { color: COLORS.text, fontSize: FONT_SIZE.sm, fontWeight: '600' },
  mealPro: { color: COLORS.textSecondary, fontSize: FONT_SIZE.xs },
  mealTime: { color: COLORS.textMuted, fontSize: FONT_SIZE.xs, width: 40, textAlign: 'right' },

  emptyText: { color: COLORS.textMuted, fontSize: FONT_SIZE.sm, textAlign: 'center', paddingVertical: SPACING.md },

  reportLinks: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  reportLink: {
    flex: 1, backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md,
    alignItems: 'center', borderWidth: 1, borderColor: COLORS.border,
  },
  reportLinkText: { color: COLORS.primary, fontSize: FONT_SIZE.sm, fontWeight: '600' },

  hint: { color: COLORS.textMuted, fontSize: 10, textAlign: 'center', marginTop: SPACING.md },
});
