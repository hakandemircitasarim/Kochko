/**
 * Workout Plan Card — Display + Set Logging
 * Spec 7.1, 7.5: Antrenman planı + güç progresyon kaydı
 *
 * Displays warmup/main/cooldown/strength targets.
 * Strength targets expand into set-by-set logging.
 */
import { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { Button } from '@/components/ui/Button';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface StrengthTarget {
  exercise: string;
  sets: number;
  reps: number;
  weight_kg: number;
}

export interface CompletedSet {
  exercise: string;
  setNumber: number;
  targetWeight: number;
  targetReps: number;
  actualWeight: number;
  actualReps: number;
  completed: boolean;
}

interface WorkoutPlan {
  type: string;
  warmup: string;
  main: string[];
  cooldown: string;
  duration_min: number;
  rpe: number;
  heart_rate_zone?: string;
  strength_targets?: StrengthTarget[];
}

interface Props {
  plan: WorkoutPlan;
  onComplete?: (sets: CompletedSet[], durationMin: number) => void;
}

const TYPE_LABELS: Record<string, string> = {
  cardio: 'Kardiyo', strength: 'Guc', flexibility: 'Esneklik',
  mixed: 'Karma', sports: 'Spor', rest: 'Dinlenme',
};

export function WorkoutCard({ plan, onComplete }: Props) {
  const [logMode, setLogMode] = useState(false);
  const [setLogs, setSetLogs] = useState<Map<string, { weight: string; reps: string; done: boolean }>>(new Map());
  const [saving, setSaving] = useState(false);

  // Initialize set logs from targets
  const initLogs = () => {
    const logs = new Map<string, { weight: string; reps: string; done: boolean }>();
    for (const st of plan.strength_targets ?? []) {
      for (let s = 1; s <= st.sets; s++) {
        logs.set(`${st.exercise}-${s}`, { weight: String(st.weight_kg), reps: String(st.reps), done: false });
      }
    }
    setSetLogs(logs);
    setLogMode(true);
  };

  const updateSet = (key: string, field: 'weight' | 'reps' | 'done', value: string | boolean) => {
    setSetLogs(prev => {
      const next = new Map(prev);
      const current = next.get(key) ?? { weight: '0', reps: '0', done: false };
      if (field === 'done') current.done = value as boolean;
      else current[field] = value as string;
      next.set(key, current);
      return next;
    });
  };

  const handleComplete = async () => {
    if (!onComplete) return;
    setSaving(true);

    const completed: CompletedSet[] = [];
    for (const st of plan.strength_targets ?? []) {
      for (let s = 1; s <= st.sets; s++) {
        const key = `${st.exercise}-${s}`;
        const log = setLogs.get(key);
        completed.push({
          exercise: st.exercise,
          setNumber: s,
          targetWeight: st.weight_kg,
          targetReps: st.reps,
          actualWeight: parseFloat(log?.weight ?? '0') || st.weight_kg,
          actualReps: parseInt(log?.reps ?? '0') || st.reps,
          completed: log?.done ?? false,
        });
      }
    }

    await onComplete(completed, plan.duration_min);
    setSaving(false);
    setLogMode(false);
  };

  if (plan.type === 'rest') {
    return (
      <View style={{ backgroundColor: COLORS.card, borderRadius: 16, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
        <Text style={{ color: COLORS.success, fontSize: FONT.lg, fontWeight: '600' }}>Dinlenme Gunu</Text>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginTop: SPACING.xs }}>
          Hafif yuruyus, esneme veya mobilite calismasi yapabilirsin.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: 16, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md }}>
        <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700' }}>
          {TYPE_LABELS[plan.type] ?? plan.type} Antrenman
        </Text>
        <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
          <Badge text={`${plan.duration_min} dk`} color={COLORS.primary} />
          <Badge text={`RPE ${plan.rpe}/10`} color={COLORS.warning} />
        </View>
      </View>

      {/* Warmup */}
      <Section title="Isinma" color={COLORS.success}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>{plan.warmup}</Text>
      </Section>

      {/* Main */}
      <Section title="Ana Bolum" color={COLORS.primary}>
        {plan.main.map((exercise, i) => (
          <View key={i} style={{ flexDirection: 'row', paddingVertical: 3 }}>
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, width: 24 }}>{i + 1}.</Text>
            <Text style={{ color: COLORS.text, fontSize: FONT.sm, flex: 1, lineHeight: 20 }}>{exercise}</Text>
          </View>
        ))}
      </Section>

      {/* Strength Targets + Logging */}
      {plan.strength_targets && plan.strength_targets.length > 0 && (
        <Section title="Guc Hedefleri" color={COLORS.warning}>
          {plan.strength_targets.map((st, i) => (
            <View key={i} style={{ marginBottom: SPACING.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                <Text style={{ color: COLORS.text, fontSize: FONT.sm, fontWeight: '600' }}>{st.exercise}</Text>
                <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '600' }}>
                  {st.sets}x{st.reps} @ {st.weight_kg}kg
                </Text>
              </View>

              {/* Set-by-set logging */}
              {logMode && Array.from({ length: st.sets }, (_, s) => {
                const key = `${st.exercise}-${s + 1}`;
                const log = setLogs.get(key) ?? { weight: String(st.weight_kg), reps: String(st.reps), done: false };
                return (
                  <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, paddingVertical: 3, paddingLeft: SPACING.sm }}>
                    <TouchableOpacity
                      onPress={() => updateSet(key, 'done', !log.done)}
                      style={{
                        width: 24, height: 24, borderRadius: 12, borderWidth: 2,
                        borderColor: log.done ? COLORS.success : COLORS.border,
                        backgroundColor: log.done ? COLORS.success : 'transparent',
                        justifyContent: 'center', alignItems: 'center',
                      }}
                    >
                      {log.done && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✓</Text>}
                    </TouchableOpacity>
                    <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, width: 30 }}>S{s + 1}</Text>
                    <TextInput
                      style={inputStyle}
                      value={log.weight}
                      onChangeText={v => updateSet(key, 'weight', v)}
                      keyboardType="decimal-pad"
                      placeholder="kg"
                      placeholderTextColor={COLORS.textMuted}
                    />
                    <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>kg</Text>
                    <TextInput
                      style={inputStyle}
                      value={log.reps}
                      onChangeText={v => updateSet(key, 'reps', v)}
                      keyboardType="number-pad"
                      placeholder="rep"
                      placeholderTextColor={COLORS.textMuted}
                    />
                    <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>rep</Text>
                  </View>
                );
              })}
            </View>
          ))}
        </Section>
      )}

      {/* Cooldown */}
      <Section title="Soguma" color={COLORS.success}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>{plan.cooldown}</Text>
      </Section>

      {/* Heart rate zone */}
      {plan.heart_rate_zone && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.border }}>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>Nabiz bolgesi: </Text>
          <Text style={{ color: COLORS.primary, fontSize: FONT.xs, fontWeight: '600' }}>{plan.heart_rate_zone}</Text>
        </View>
      )}

      {/* Log / Complete Buttons */}
      {onComplete && plan.strength_targets && plan.strength_targets.length > 0 && (
        <View style={{ marginTop: SPACING.md }}>
          {!logMode ? (
            <Button title="Setleri Kaydet" variant="outline" size="sm" onPress={initLogs} />
          ) : (
            <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
              <Button title="Antrenmani Tamamla" size="sm" onPress={handleComplete} loading={saving} style={{ flex: 1 }} />
              <Button title="Iptal" variant="ghost" size="sm" onPress={() => setLogMode(false)} style={{ flex: 1 }} />
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const inputStyle = {
  backgroundColor: COLORS.surfaceLight,
  borderRadius: 6,
  paddingHorizontal: 8,
  paddingVertical: 4,
  color: COLORS.text,
  fontSize: FONT.sm,
  width: 50,
  textAlign: 'center' as const,
  borderWidth: 1,
  borderColor: COLORS.border,
};

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <View style={{ backgroundColor: COLORS.surfaceLight, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
      <Text style={{ color, fontSize: FONT.xs, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: SPACING.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginBottom: SPACING.xs }}>
        <View style={{ width: 3, height: 14, backgroundColor: color, borderRadius: 2 }} />
        <Text style={{ color, fontSize: FONT.xs, fontWeight: '700', textTransform: 'uppercase' }}>{title}</Text>
      </View>
      {children}
    </View>
  );
}
