/**
 * Smart Actions - Context-aware action suggestions
 * Shows different actions based on time of day, user's logged data,
 * and available features. The app tells the user what to do next.
 */
import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, GRADIENTS } from '@/lib/theme';
import { SPACING, FONT, RADIUS, CARD_SHADOW } from '@/lib/constants';

interface UserState {
  mealsLogged: number;
  waterLiters: number;
  waterTarget: number;
  weightLogged: boolean;
  moodLogged: boolean;
  sleepLogged: boolean;
  stepsLogged: boolean;
  hasActiveGoal: boolean;
  hasPlan: boolean;
  workoutsLogged: number;
}

interface ActionItem {
  id: string;
  icon: string;
  title: string;
  subtitle: string;
  gradient: [string, string];
  priority: number;
}

interface Props {
  userState: UserState;
  onMealLog: () => void;
  onWorkoutLog: () => void;
  onWeightLog: () => void;
  onWaterAdd: () => void;
  onSleepLog: () => void;
  onMoodLog: () => void;
  onChat: () => void;
  onViewPlan: () => void;
  onViewWorkout: () => void;
  onBarcodeScan: () => void;
  onSimulation: () => void;
  onQuickLog: () => void;
}

function getTimeOfDay(): 'morning' | 'midday' | 'afternoon' | 'evening' | 'night' {
  const h = new Date().getHours();
  if (h >= 6 && h < 10) return 'morning';
  if (h >= 10 && h < 14) return 'midday';
  if (h >= 14 && h < 18) return 'afternoon';
  if (h >= 18 && h < 22) return 'evening';
  return 'night';
}

function getMealLabel(time: ReturnType<typeof getTimeOfDay>): string {
  switch (time) {
    case 'morning': return 'Kahvaltını kaydet';
    case 'midday': return 'Öğle yemeğini kaydet';
    case 'afternoon': return 'Ara öğünü kaydet';
    case 'evening': return 'Akşam yemeğini kaydet';
    case 'night': return 'Gece atıştırmasını kaydet';
  }
}

function generateActions(userState: UserState, time: ReturnType<typeof getTimeOfDay>): ActionItem[] {
  const actions: ActionItem[] = [];

  // ---- Meal logging (always relevant) ----
  const mealPriority = (time === 'morning' || time === 'midday' || time === 'evening') ? 1 : 3;
  actions.push({
    id: 'meal',
    icon: time === 'morning' ? 'sunny' : time === 'evening' || time === 'night' ? 'moon' : 'restaurant',
    title: getMealLabel(time),
    subtitle: userState.mealsLogged === 0 ? 'Bugün henüz bir şey kaydetmedin' : `${userState.mealsLogged} öğün kaydedildi`,
    gradient: GRADIENTS.calories,
    priority: userState.mealsLogged === 0 ? 0 : mealPriority,
  });

  // ---- View today's plan (if exists) ----
  if (userState.hasPlan) {
    actions.push({
      id: 'viewPlan',
      icon: 'calendar',
      title: 'Günün planını gör',
      subtitle: 'Koçunun hazırladığı plan',
      gradient: GRADIENTS.primary,
      priority: userState.mealsLogged === 0 ? 1 : 4,
    });
  }

  // ---- Workout (go to plan's workout, not chat) ----
  if (time === 'afternoon' || time === 'evening' || time === 'morning') {
    if (userState.workoutsLogged === 0) {
      actions.push({
        id: 'workout',
        icon: 'barbell',
        title: userState.hasPlan ? 'Antrenmanını gör' : 'Antrenman kaydet',
        subtitle: userState.hasPlan ? 'Koçunun planladığı antrenman' : 'Ne yaptığını kaydet',
        gradient: ['#6C63FF', '#A78BFA'] as [string, string],
        priority: (time === 'afternoon' || time === 'evening') ? 2 : 5,
      });
    }
  }

  // ---- Weight (morning is best) ----
  if (!userState.weightLogged) {
    actions.push({
      id: 'weight',
      icon: 'scale',
      title: 'Tartıl',
      subtitle: time === 'morning' ? 'Sabah tartılmak en doğru sonuç verir' : 'Bugün henüz tartılmadın',
      gradient: GRADIENTS.weight,
      priority: time === 'morning' ? 0 : 5,
    });
  }

  // ---- Water ----
  if (userState.waterLiters < userState.waterTarget) {
    const pct = Math.round((userState.waterLiters / userState.waterTarget) * 100);
    const remaining = (userState.waterTarget - userState.waterLiters).toFixed(1);
    actions.push({
      id: 'water',
      icon: 'water',
      title: 'Su iç (+0.25L)',
      subtitle: pct > 0 ? `%${pct} tamamlandı, ${remaining}L kaldı` : `Günlük ${userState.waterTarget}L hedefin var`,
      gradient: GRADIENTS.water,
      priority: pct < 30 ? 2 : 6,
    });
  }

  // ---- Sleep (morning) ----
  if (!userState.sleepLogged && (time === 'morning' || time === 'midday')) {
    actions.push({
      id: 'sleep',
      icon: 'moon',
      title: 'Uykunu kaydet',
      subtitle: 'Dün gece nasıl uyudun?',
      gradient: GRADIENTS.sleep,
      priority: time === 'morning' ? 1 : 4,
    });
  }

  // ---- Barcode scanner (useful around meal times) ----
  if (time === 'morning' || time === 'midday' || time === 'evening') {
    actions.push({
      id: 'barcode',
      icon: 'barcode',
      title: 'Barkod tarat',
      subtitle: 'Paketli ürünü hızlıca kaydet',
      gradient: ['#64748B', '#94A3B8'] as [string, string],
      priority: 7,
    });
  }

  // ---- Simulation ("şunu yesem ne olur?") ----
  if (userState.mealsLogged > 0) {
    actions.push({
      id: 'simulation',
      icon: 'help-circle',
      title: 'Şunu yesem ne olur?',
      subtitle: 'Yemeden önce etkisini gör',
      gradient: GRADIENTS.mood,
      priority: 6,
    });
  }

  // ---- Mood ----
  if (!userState.moodLogged) {
    actions.push({
      id: 'mood',
      icon: 'happy',
      title: 'Nasıl hissediyorsun?',
      subtitle: 'Günlük ruh halini kaydet',
      gradient: GRADIENTS.mood,
      priority: 7,
    });
  }

  // ---- Quick log (always available, low priority) ----
  actions.push({
    id: 'quicklog',
    icon: 'flash',
    title: 'Hızlı kayıt',
    subtitle: 'Bir şeyi hızlıca not et',
    gradient: GRADIENTS.success,
    priority: 8,
  });

  // ---- Coach chat (always available, lowest) ----
  actions.push({
    id: 'chat',
    icon: 'chatbubble-ellipses',
    title: 'Koçunla konuş',
    subtitle: 'Bir şey sor, tavsiye al',
    gradient: ['#6C63FF', '#A78BFA'] as [string, string],
    priority: 9,
  });

  return actions.sort((a, b) => a.priority - b.priority);
}

export function SmartActions({
  userState, onMealLog, onWorkoutLog, onWeightLog, onWaterAdd,
  onSleepLog, onMoodLog, onChat, onViewPlan, onViewWorkout,
  onBarcodeScan, onSimulation, onQuickLog,
}: Props) {
  const { colors, isDark } = useTheme();
  const time = getTimeOfDay();
  const actions = generateActions(userState, time);
  const visibleActions = actions.slice(0, 5);

  const handlePress = (id: string) => {
    switch (id) {
      case 'meal': onMealLog(); break;
      case 'workout': userState.hasPlan ? onViewWorkout() : onWorkoutLog(); break;
      case 'viewPlan': onViewPlan(); break;
      case 'weight': onWeightLog(); break;
      case 'water': onWaterAdd(); break;
      case 'sleep': onSleepLog(); break;
      case 'mood': onMoodLog(); break;
      case 'chat': onChat(); break;
      case 'barcode': onBarcodeScan(); break;
      case 'simulation': onSimulation(); break;
      case 'quicklog': onQuickLog(); break;
    }
  };

  const heroAction = visibleActions[0];
  const secondaryActions = visibleActions.slice(1);

  return (
    <View>
      <Text style={{ fontSize: FONT.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: SPACING.sm }}>
        Şimdi ne yapsak?
      </Text>

      {/* Hero action */}
      {heroAction && (
        <TouchableOpacity onPress={() => handlePress(heroAction.id)} activeOpacity={0.8} style={{ marginBottom: SPACING.sm }}>
          <LinearGradient
            colors={heroAction.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0.8 }}
            style={{ borderRadius: RADIUS.xxl, padding: SPACING.md, flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}
          >
            <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={heroAction.icon as any} size={26} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#fff', fontSize: FONT.lg, fontWeight: '800' }}>{heroAction.title}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: FONT.xs, marginTop: 2 }}>{heroAction.subtitle}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.6)" />
          </LinearGradient>
        </TouchableOpacity>
      )}

      {/* Secondary actions */}
      {secondaryActions.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACING.sm }}>
          {secondaryActions.map(action => (
            <TouchableOpacity
              key={action.id}
              onPress={() => handlePress(action.id)}
              activeOpacity={0.7}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
                backgroundColor: colors.card, borderRadius: RADIUS.xl,
                paddingVertical: SPACING.sm + 2, paddingHorizontal: SPACING.md,
                ...(isDark ? { borderWidth: 1, borderColor: colors.border } : CARD_SHADOW),
              }}
            >
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: action.gradient[0] + '15', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={action.icon as any} size={18} color={action.gradient[0]} />
              </View>
              <View style={{ maxWidth: 140 }}>
                <Text style={{ color: colors.text, fontSize: FONT.sm, fontWeight: '700' }} numberOfLines={1}>{action.title}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 10 }} numberOfLines={1}>{action.subtitle}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
