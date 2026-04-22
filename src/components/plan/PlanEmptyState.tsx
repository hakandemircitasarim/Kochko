/**
 * Empty state for plan screens — shown when no active and no draft exists.
 * CTA is disabled when prerequisites are missing; each missing field becomes
 * a clickable card routing to the correct onboarding task chat.
 */
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { createSession } from '@/services/chat.service';
import type { MissingField } from '@/lib/plan-readiness';

interface Props {
  planType: 'diet' | 'workout';
  missingCore: MissingField[];
  weakSpots: MissingField[];
  onCreate: () => void;
  creating?: boolean;
}

export function PlanEmptyState({ planType, missingCore, weakSpots, onCreate, creating }: Props) {
  const { colors } = useTheme();
  const ready = missingCore.length === 0;

  const openTaskChat = async (taskKey: string, taskTitle: string) => {
    const id = await createSession({ title: taskTitle, topicTags: [taskKey] });
    if (id) {
      router.push({
        pathname: `/chat/${id}` as never,
        params: { taskModeHint: `onboarding_${taskKey === 'introduce_yourself' ? 'intro' : taskKey === 'set_goal' ? 'goal' : taskKey}` },
      });
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md }}>
      <View style={{ alignItems: 'center', marginTop: SPACING.lg }}>
        <View
          style={{
            width: 80,
            height: 80,
            borderRadius: 24,
            backgroundColor: planType === 'diet' ? '#22C55E18' : '#6366F118',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons
            name={planType === 'diet' ? 'restaurant-outline' : 'barbell-outline'}
            size={40}
            color={planType === 'diet' ? '#22C55E' : '#6366F1'}
          />
        </View>
        <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800', marginTop: SPACING.md }}>
          {planType === 'diet' ? 'Diyet planın yok' : 'Spor planın yok'}
        </Text>
        <Text
          style={{
            color: colors.textMuted,
            fontSize: FONT.sm,
            textAlign: 'center',
            marginTop: 4,
            maxWidth: 280,
          }}
        >
          {planType === 'diet'
            ? 'Profiline bakarak haftalık bir menu hazırlayacağım. İstediğin zaman değiştirebilirsin.'
            : 'Seviyene ve ekipmanına göre haftalık bir program hazırlayacağım.'}
        </Text>
      </View>

      {/* Missing core — block plan creation */}
      {missingCore.length > 0 ? (
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: '#F59E0B44',
            padding: SPACING.md,
            marginTop: SPACING.md,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="alert-circle-outline" size={16} color="#F59E0B" />
            <Text style={{ color: '#F59E0B', fontSize: FONT.sm, fontWeight: '700' }}>
              Plan için eksik bilgiler
            </Text>
          </View>
          <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: 4 }}>
            Şu bilgileri tamamlayınca plan oluşturulabilir:
          </Text>
          <View style={{ marginTop: SPACING.sm, gap: SPACING.xs }}>
            {missingCore.map((f, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => openTaskChat(f.taskKey, f.taskTitle)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: colors.surfaceLight,
                  borderRadius: RADIUS.md,
                  padding: SPACING.sm + 2,
                  gap: SPACING.sm,
                }}
              >
                <Ionicons name="arrow-forward-circle" size={16} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: FONT.sm, fontWeight: '600' }}>
                    {f.field}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 10 }}>
                    {f.taskTitle} kartından tamamla
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}

      {/* CTA */}
      <TouchableOpacity
        onPress={onCreate}
        disabled={!ready || creating}
        style={{
          marginTop: SPACING.md,
          backgroundColor: ready && !creating ? colors.primary : colors.surfaceLight,
          borderRadius: RADIUS.xl,
          paddingVertical: SPACING.md,
          alignItems: 'center',
        }}
      >
        <Text
          style={{
            color: ready && !creating ? '#fff' : colors.textMuted,
            fontSize: FONT.md,
            fontWeight: '800',
          }}
        >
          {creating ? 'Hazırlanıyor...' : ready ? 'Plan oluştur' : 'Önce bilgileri tamamla'}
        </Text>
      </TouchableOpacity>

      {/* Weak spots — optional */}
      {weakSpots.length > 0 && ready ? (
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: colors.border,
            padding: SPACING.md,
            marginTop: SPACING.sm,
          }}
        >
          <Text style={{ color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>
            PLAN DAHA İYİ OLABİLİR
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, marginTop: 4 }}>
            Şunları da konuşursak plan daha kişisel olur:
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: SPACING.sm }}>
            {weakSpots.slice(0, 4).map((f, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => openTaskChat(f.taskKey, f.taskTitle)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  backgroundColor: colors.surfaceLight,
                  borderRadius: RADIUS.full,
                  paddingHorizontal: SPACING.sm,
                  paddingVertical: 4,
                }}
              >
                <Ionicons name="add-circle-outline" size={12} color={colors.primary} />
                <Text style={{ color: colors.text, fontSize: 10, fontWeight: '600' }}>
                  {f.field}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}
