import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { COLORS, SPACING, FONT_SIZE } from '@/lib/constants';

interface CoachingMessage {
  id: string;
  content: string;
  message_type: string;
  trigger: string;
  created_at: string;
}

/**
 * Displays the latest unread coaching message as a banner.
 * Shows on the Today dashboard. Dismissable.
 */
export function CoachingBanner() {
  const user = useAuthStore((s) => s.user);
  const [message, setMessage] = useState<CoachingMessage | null>(null);

  useEffect(() => {
    async function loadLatest() {
      if (!user?.id) return;
      const { data } = await supabase
        .from('coaching_messages')
        .select('*')
        .eq('user_id', user.id)
        .eq('read', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (data) setMessage(data as CoachingMessage);
    }
    loadLatest();
  }, [user?.id]);

  const handleDismiss = async () => {
    if (!message) return;
    await supabase
      .from('coaching_messages')
      .update({ read: true })
      .eq('id', message.id);
    setMessage(null);
  };

  if (!message) return null;

  return (
    <View style={styles.banner}>
      <View style={styles.header}>
        <Text style={styles.label}>Koç Notu</Text>
        <TouchableOpacity onPress={handleDismiss}>
          <Text style={styles.dismiss}>Kapat</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.content}>{message.content}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  label: {
    color: COLORS.primary,
    fontSize: FONT_SIZE.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  dismiss: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
  },
  content: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    lineHeight: 22,
  },
});
