/**
 * CoachingNudge — Shows proactive coaching messages on the dashboard.
 * Taps dismiss the message. Flat dark design.
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';
import type { CoachingMessage } from '@/services/coaching-messages.service';

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
  const PRIORITY_COLORS: Record<string, string> = {
    high: colors.error,
    medium: colors.warning,
    low: colors.success,
  };
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
            // FIX (ux-pass5): dış dokunulabilir varsayılan accessible={true} ile tüm alt
            // öğeleri tek a11y düğümüne düzleştiriyordu — 'Bildirimi kapat' ekran okuyucuya
            // hiç çıkmıyordu (nudge kapatılamıyor, tek eylem chat'e zorluyordu). Dış katman
            // artık a11y kapsayıcı değil; kart gövdesi ve kapat düğmesi iki ayrı, gerçek düğme.
            accessible={false}
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
            <TouchableOpacity
              onPress={() => onTap(msg)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={msg.content}
              accessibilityHint="Koç ile bu konuda konuşmak için dokun"
              style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start' }}
            >
              <Ionicons
                name="chatbubble-ellipses-outline" size={18} color={accentColor}
                style={{ marginRight: SPACING.sm, marginTop: 1 }}
                accessible={false} importantForAccessibility="no"
              />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 13, lineHeight: 19 }} numberOfLines={3}>
                  {msg.content}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }}>
                  {new Date(msg.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onDismiss(msg.id)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Bildirimi kapat"
            >
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
