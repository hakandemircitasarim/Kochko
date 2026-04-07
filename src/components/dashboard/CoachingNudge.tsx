/**
 * CoachingNudge — Shows proactive coaching messages on the dashboard.
 * Taps dismiss the message. Flat dark design.
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';
import type { CoachingMessage } from '@/services/coaching-messages.service';

const PRIORITY_COLORS: Record<string, string> = {
  high: '#D85A30',
  medium: '#EF9F27',
  low: '#1D9E75',
};

export function CoachingNudge({
  messages,
  onDismiss,
  onTap,
}: {
  messages: CoachingMessage[];
  onDismiss: (id: string) => void;
  onTap: (msg: CoachingMessage) => void;
}) {
  const { colors } = useTheme();
  if (messages.length === 0) return null;

  return (
    <View style={{ gap: SPACING.sm, marginBottom: SPACING.md }}>
      {messages.map((msg) => {
        const accentColor = PRIORITY_COLORS[msg.priority] ?? colors.primary;
        return (
          <TouchableOpacity
            key={msg.id}
            onPress={() => onTap(msg)}
            activeOpacity={0.7}
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              backgroundColor: colors.card,
              borderRadius: RADIUS.md,
              padding: SPACING.md,
              borderLeftWidth: 3,
              borderLeftColor: accentColor,
              borderWidth: 0.5,
              borderColor: colors.border,
            }}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={accentColor} style={{ marginRight: SPACING.sm, marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 13, lineHeight: 19 }} numberOfLines={3}>
                {msg.message}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 4 }}>
                {new Date(msg.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
            <TouchableOpacity onPress={() => onDismiss(msg.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
