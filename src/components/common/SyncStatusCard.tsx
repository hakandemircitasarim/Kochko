/**
 * SyncStatusCard (ux-round2 #5) — surfaces the offline queue so a silent sync failure can't
 * make the user think data saved when it never reached the server (the most dangerous failure
 * class for a health/nutrition app). The counters + retry already existed in offline-queue.service
 * (getQueueStatus / syncQueue) but had NO UI consumer. Self-contained; renders nothing when the
 * queue is empty, so it's invisible in the normal case.
 */
import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE, MOTION } from '@/lib/design';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';
import { getQueueStatus, syncQueue, isOnline } from '@/services/offline-queue.service';
import { showToast } from '@/components/ui/Toast';

export function SyncStatusCard() {
  const { colors } = useTheme();
  const [status, setStatus] = useState<{ pending: number; failed: number } | null>(null);
  const [retrying, setRetrying] = useState(false);

  const refresh = useCallback(() => {
    getQueueStatus().then((s) => setStatus({ pending: s.pending, failed: s.failed })).catch(() => {});
  }, []);
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  if (!status || (status.pending === 0 && status.failed === 0)) return null;

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    haptics.tap();
    try {
      if (!(await isOnline())) {
        showToast('İnternet yok — bağlanınca otomatik denenecek', { variant: 'info' });
        return;
      }
      const res = await syncQueue();
      refresh();
      showToast(res.failed > 0 ? `${res.failed} kayıt hâlâ bekliyor` : 'Kayıtlar senkronize edildi',
        { variant: res.failed > 0 ? 'error' : 'success' });
    } catch {
      showToast('Senkronizasyon başarısız', { variant: 'error' });
    } finally {
      setRetrying(false);
    }
  };

  // FIX (adversarial-review): failed items STAY in the queue (syncQueue continues on failure without
  // removing them), so `pending` (live queue length) is always the accurate unsynced count. The
  // `failed` value is a stale last-run number that can only equal or undercount pending — never use
  // it as the primary count, or newly-queued items after a partial failure are under-reported.
  const count = status.pending;
  return (
    <View style={{
      backgroundColor: colors.card, borderRadius: RADIUS.md,
      borderWidth: 0.5, borderColor: colors.border,
      borderLeftWidth: 3, borderLeftColor: colors.warning,
      padding: SPACING.lg, marginTop: SPACING.lg,
      flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    }}>
      <Ionicons name="cloud-offline-outline" size={20} color={colors.warning} />
      <View style={{ flex: 1 }}>
        <Text style={{ ...TYPE.bodyStrong, color: colors.text, fontWeight: '700' }}>{count} kayıt senkronize edilmedi</Text>
        <Text style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: 1 }}>Bu kayıtlar henüz sunucuya ulaşmadı.</Text>
      </View>
      <TouchableOpacity activeOpacity={MOTION.pressOpacity}
        onPress={retry}
        disabled={retrying}
        accessibilityRole="button"
        accessibilityLabel="Şimdi senkronize et"
        style={{ backgroundColor: colors.primary, borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: 7, opacity: retrying ? 0.6 : 1 }}
      >
        {retrying
          ? <ActivityIndicator size="small" color={getContrastColor(colors.primary)} />
          : <Text style={{ ...TYPE.caption, color: getContrastColor(colors.primary), fontWeight: '700' }}>Şimdi dene</Text>}
      </TouchableOpacity>
    </View>
  );
}
