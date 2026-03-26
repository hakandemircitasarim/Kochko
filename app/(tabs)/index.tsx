import { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useLogStore } from '@/stores/log.store';
import { Card } from '@/components/ui/Card';
import { CoachingBanner } from '@/components/coaching/CoachingBanner';
import { COLORS, SPACING, FONT_SIZE, WATER_INCREMENT } from '@/lib/constants';

export default function TodayScreen() {
  const user = useAuthStore((s) => s.user);
  const { today, fetchTodayLogs, addWater } = useLogStore();

  useEffect(() => {
    if (user?.id) fetchTodayLogs(user.id);
  }, [user?.id, fetchTodayLogs]);

  const todayStr = new Date().toISOString().split('T')[0];

  const totalCalories = today.meals.reduce(
    (sum, m) => sum + m.items.reduce((s, i) => s + i.calories, 0),
    0
  );
  const totalProtein = today.meals.reduce(
    (sum, m) => sum + m.items.reduce((s, i) => s + i.protein_g, 0),
    0
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.greeting}>Bugün</Text>
      <Text style={styles.date}>
        {new Date().toLocaleDateString('tr-TR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })}
      </Text>

      {/* Coaching Banner */}
      <CoachingBanner />

      {/* Quick Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{totalCalories}</Text>
          <Text style={styles.statLabel}>kcal</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{Math.round(totalProtein)}g</Text>
          <Text style={styles.statLabel}>protein</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>
            {today.metrics?.water_liters?.toFixed(1) ?? '0.0'}L
          </Text>
          <Text style={styles.statLabel}>su</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{today.workouts.length}</Text>
          <Text style={styles.statLabel}>antrenman</Text>
        </View>
      </View>

      {/* Quick Actions */}
      <Card title="Hızlı Kayıt">
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.quickBtn}
            onPress={() => router.push('/log/meal')}
          >
            <Text style={styles.quickBtnIcon}>🍽</Text>
            <Text style={styles.quickBtnText}>Öğün</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickBtn}
            onPress={() => router.push('/log/workout')}
          >
            <Text style={styles.quickBtnIcon}>💪</Text>
            <Text style={styles.quickBtnText}>Spor</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickBtn}
            onPress={() => router.push('/log/weight')}
          >
            <Text style={styles.quickBtnIcon}>⚖️</Text>
            <Text style={styles.quickBtnText}>Tartı</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickBtn}
            onPress={() => user?.id && addWater(user.id, todayStr, WATER_INCREMENT)}
          >
            <Text style={styles.quickBtnIcon}>💧</Text>
            <Text style={styles.quickBtnText}>+Su</Text>
          </TouchableOpacity>
        </View>
      </Card>

      {/* Today's Meals */}
      <Card title="Öğünler">
        {today.meals.length === 0 ? (
          <Text style={styles.emptyText}>Henüz öğün kaydı yok</Text>
        ) : (
          today.meals.map((meal) => (
            <View key={meal.id} style={styles.logItem}>
              <Text style={styles.logType}>{meal.meal_type}</Text>
              <Text style={styles.logText}>{meal.raw_input}</Text>
              <Text style={styles.logMacro}>
                {meal.items.reduce((s, i) => s + i.calories, 0)} kcal
              </Text>
            </View>
          ))
        )}
      </Card>

      {/* Today's Workouts */}
      <Card title="Antrenmanlar">
        {today.workouts.length === 0 ? (
          <Text style={styles.emptyText}>Henüz antrenman kaydı yok</Text>
        ) : (
          today.workouts.map((w) => (
            <View key={w.id} style={styles.logItem}>
              <Text style={styles.logText}>{w.raw_input}</Text>
              <Text style={styles.logMacro}>{w.duration_min} dk</Text>
            </View>
          ))
        )}
      </Card>

      {/* Report Links */}
      <View style={styles.reportLinks}>
        <TouchableOpacity
          style={styles.reportLink}
          onPress={() => router.push('/reports/daily')}
        >
          <Text style={styles.reportLinkText}>Gün Sonu Raporu</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.reportLink}
          onPress={() => router.push('/reports/weekly')}
        >
          <Text style={styles.reportLinkText}>Haftalık Rapor</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
  greeting: {
    fontSize: FONT_SIZE.xxl,
    fontWeight: '800',
    color: COLORS.text,
  },
  date: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textSecondary,
    marginBottom: SPACING.lg,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.lg,
  },
  statBox: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: SPACING.md,
    alignItems: 'center',
    flex: 1,
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statValue: {
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
    color: COLORS.primary,
  },
  statLabel: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  quickBtn: {
    alignItems: 'center',
    padding: SPACING.sm,
  },
  quickBtnIcon: {
    fontSize: 28,
  },
  quickBtnText: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  logItem: {
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  logType: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.primary,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  logText: {
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
    marginTop: 2,
  },
  logMacro: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    textAlign: 'center',
    paddingVertical: SPACING.md,
  },
  reportLinks: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  reportLink: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: SPACING.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  reportLinkText: {
    color: COLORS.primary,
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
  },
});
