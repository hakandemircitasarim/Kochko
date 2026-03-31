/**
 * Sync Status Component
 * Spec 11: Shows offline queue status, last sync time, and manual sync button.
 */
import { useState, useEffect } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { getQueueStatus, syncQueue } from '@/services/offline-queue.service';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export function SyncStatus() {
  const [pending, setPending] = useState(0);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const loadStatus = async () => {
    const status = await getQueueStatus();
    setPending(status.pending);
    setLastSync(status.lastSyncAt);
  };

  useEffect(() => { loadStatus(); }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncQueue();
      await loadStatus();
    } finally {
      setSyncing(false);
    }
  };

  const formatTime = (iso: string | null) => {
    if (!iso) return 'Henuz senkronize edilmedi';
    return new Date(iso).toLocaleString('tr-TR', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <Card>
      <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '700', marginBottom: SPACING.sm }}>
        Senkronizasyon
      </Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.xs }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Bekleyen islem</Text>
        <Text style={{ color: pending > 0 ? COLORS.warning : COLORS.success, fontSize: FONT.sm, fontWeight: '600' }}>
          {pending}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.md }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Son senkronizasyon</Text>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm }}>{formatTime(lastSync)}</Text>
      </View>
      {syncing ? (
        <ActivityIndicator color={COLORS.primary} />
      ) : (
        <Button title="Simdi Senkronize Et" onPress={handleSync} variant={pending > 0 ? 'primary' : 'outline'} />
      )}
    </Card>
  );
}
