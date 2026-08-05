/**
 * Life-event countdown card (ux-ideas #6).
 *
 * The coach already remembers dated motivating events across sessions
 * (life_events table + shared/life-events.ts) and counts them down on every
 * turn — but the user never saw them on any screen. This surfaces the nearest
 * upcoming event as a teal countdown on the dashboard: the single most personal
 * reason the person is doing this, made visible. Tap → chat, prefilled.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { PressableCard } from '@/components/ui/PressableCard';

export interface LifeEvent {
  id: string;
  title: string;
  event_type: string;
  event_date: string; // yyyy-mm-dd
}

interface Props {
  event: LifeEvent;
  todayISO: string; // effective "today" (respects day-boundary)
  onPress?: () => void;
}

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  wedding: 'heart',
  engagement: 'heart-circle',
  vacation: 'airplane',
  beach: 'sunny',
  graduation: 'school',
  birthday: 'gift',
  reunion: 'people',
  exam: 'book',
  photoshoot: 'camera',
  competition: 'trophy',
  other: 'calendar',
};

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO}T00:00:00Z`).getTime();
  const b = new Date(`${toISO}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.round((b - a) / 86_400_000);
}

const cap = (s: string) => (s ? s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1) : s);

export function LifeEventCard({ event, todayISO, onPress }: Props) {
  const { colors } = useTheme();
  const days = daysBetween(todayISO, event.event_date);
  if (!Number.isFinite(days) || days < 0) return null;

  const icon = ICONS[event.event_type] ?? ICONS.other;
  const countdown = days === 0 ? 'Bugün!' : days === 1 ? 'Yarın' : `${days} gün kaldı`;
  const title = cap(event.title);

  return (
    <PressableCard
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${countdown}. Koçunla konuşmak için dokun`}
      style={{
        backgroundColor: colors.card,
        borderRadius: RADIUS.md,
        borderWidth: 0.5,
        borderColor: colors.border,
        borderLeftWidth: 3,
        borderLeftColor: colors.primary,
        padding: SPACING.lg,
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.md,
      }}
    >
      <View style={{
        width: 40, height: 40, borderRadius: RADIUS.sm,
        backgroundColor: colors.primary + '18',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ ...TYPE.headline, color: colors.text }} numberOfLines={1}>
          {title}
        </Text>
        <Text style={{ ...TYPE.caption, color: colors.primary, fontWeight: '600', marginTop: 1 }} maxFontSizeMultiplier={1.3}>
          {countdown}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </PressableCard>
  );
}
