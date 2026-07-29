/**
 * CoachingNudge — Shows proactive coaching messages on the dashboard.
 * Taps open the relevant screen; offer-type nudges get inline Evet/Sonra. Flat dark design.
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { getContrastColor } from '@/lib/accessibility';
import { SPACING, RADIUS, FONT } from '@/lib/constants';
import { OFFER_TRIGGERS } from '@/services/coaching-messages.service';
import type { CoachingMessage } from '@/services/coaching-messages.service';

// FIX (ux-ideas #17): trigger types that are an accept/decline OFFER — these get inline
// "Evet / Sonra" buttons so the user can act in one tap instead of open-chat-then-type-"evet".
// ux-defect pass: the set now lives in coaching-messages.service (ONE owner — it also drives
// the 48h offer shelf there); this alias keeps local call sites unchanged.
const SUGGESTION_TRIGGERS = OFFER_TRIGGERS;

// ux-defect pass: a yesterday-born message used to render a bare "10:07" that read as TODAY'S
// 10:07 — the coach looked like it was speaking from a stale context. Day-aware stamp instead.
function formatNudgeTime(createdAt: string): string {
  const d = new Date(createdAt);
  const hm = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return hm;
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate();
  if (isYesterday) return `Dün ${hm}`;
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

export function CoachingNudge({
  messages,
  onDismiss,
  onTap,
  onAccept,
}: {
  messages: CoachingMessage[];
  onDismiss: (id: string) => void;
  onTap: (msg: CoachingMessage) => void;
  onAccept?: (msg: CoachingMessage) => void;
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
        const showOffer = !!onAccept && SUGGESTION_TRIGGERS.has(msg.trigger_type);
        return (
          // FIX (ux-pass5): the card is a plain View (not an outer TouchableOpacity) so the
          // content-tap, close, and Evet/Sonra are three distinct, screen-reader-visible buttons
          // instead of one flattened a11y node.
          <View
            key={msg.id}
            style={{
              backgroundColor: colors.card,
              borderRadius: RADIUS.md,
              padding: SPACING.md,
              borderLeftWidth: 3,
              borderLeftColor: accentColor,
              borderWidth: 0.5,
              borderColor: colors.border,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              <TouchableOpacity
                onPress={() => onTap(msg)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={msg.content}
                accessibilityHint="İlgili ekranı açmak için dokun"
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
                    {formatNudgeTime(msg.created_at)}
                  </Text>
                </View>
              </TouchableOpacity>
              {/* FIX (ux-polish): 16px icon + hitSlop 14 ≈ 44dp min touch target (was ~36dp). */}
              <TouchableOpacity
                onPress={() => onDismiss(msg.id)}
                hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                accessibilityRole="button"
                accessibilityLabel="Bildirimi kapat"
              >
                <Ionicons name="close" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* FIX (ux-ideas #17): one-tap accept for offer-type nudges (habit stacking, deload,
                progressive overload…). "Evet" opens the coach with an affirmation prefilled;
                "Sonra" dismisses. Turns a 3-step accept (find card → open chat → type "evet")
                into a single tap so the habit-stacking loop actually closes. */}
            {showOffer && (
              <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
                <TouchableOpacity
                  onPress={() => onAccept!(msg)}
                  accessibilityRole="button"
                  accessibilityLabel="Evet, uygulayalım"
                  style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4, paddingVertical: SPACING.sm, borderRadius: RADIUS.sm, backgroundColor: colors.primary }}
                >
                  <Ionicons name="checkmark" size={14} color={getContrastColor(colors.primary)} />
                  <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '700' }}>Evet</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => onDismiss(msg.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Sonra"
                  style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: SPACING.sm, borderRadius: RADIUS.sm, backgroundColor: colors.surfaceLight }}
                >
                  <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '700' }}>Sonra</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}
