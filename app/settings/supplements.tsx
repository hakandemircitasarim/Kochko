/**
 * Supplement Tracking Screen — Spec 3.1
 * Quick presets, custom entry, today's logs, daily macro impact,
 * drug interaction warnings (Spec 5.6).
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import {
  getTodaySupplements, logSupplement, getDailySupplementTotals,
  checkSupplementDrugInteraction, deleteSupplementLog, type SupplementLog,
} from '@/services/supplements.service';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, EmptyState } from '@/components/ui/Card';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';

const QUICK_SUPPS = [
  { name: 'Protein Tozu', amount: '1 olcu', emoji: '💪', cal: '~120 kcal' },
  { name: 'Kreatin', amount: '5g', emoji: '⚡', cal: '0 kcal' },
  { name: 'Omega-3', amount: '1 kapsul', emoji: '🐟', cal: '~25 kcal' },
  { name: 'D Vitamini', amount: '1 tablet', emoji: '☀️', cal: '0 kcal' },
  { name: 'Multivitamin', amount: '1 tablet', emoji: '💊', cal: '0 kcal' },
  { name: 'BCAA', amount: '1 olcu', emoji: '🧪', cal: '~20 kcal' },
  { name: 'Magnezyum', amount: '1 tablet', emoji: '🔋', cal: '0 kcal' },
  { name: 'Cinko', amount: '1 tablet', emoji: '🛡️', cal: '0 kcal' },
];

export default function SupplementsScreen() {
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const [logs, setLogs] = useState<SupplementLog[]>([]);
  const [totals, setTotals] = useState({ totalCalories: 0, totalProtein: 0 });
  const [loading, setLoading] = useState(true);
  const [customName, setCustomName] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  const [interactionWarning, setInteractionWarning] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [logsData, totalsData] = await Promise.all([
      getTodaySupplements(),
      getDailySupplementTotals(),
    ]);
    setLogs(logsData);
    setTotals(totalsData);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Check drug interactions when supplements change
  useEffect(() => {
    if (logs.length === 0) return;
    const p = (profile ?? {}) as Record<string, unknown>;
    // Get medications from health events
    supabase.from('health_events').select('description')
      .eq('event_type', 'medication').eq('is_ongoing', true)
      .then(({ data }) => {
        const meds = (data ?? []).map(d => (d as { description: string }).description);
        if (meds.length === 0) return;
        for (const log of logs) {
          const warning = checkSupplementDrugInteraction(log.supplement_name, meds);
          if (warning) { setInteractionWarning(warning); return; }
        }
      });
  }, [logs, profile]);

  const handleQuickAdd = async (supp: typeof QUICK_SUPPS[0]) => {
    const result = await logSupplement(supp.name, supp.amount);
    load();
    if (result.calories > 0) {
      Alert.alert('Kaydedildi', `${supp.name} — ${result.calories} kcal, ${result.protein_g}g protein.`);
    }
  };

  const handleCustomAdd = async () => {
    if (!customName.trim()) { Alert.alert('Hata', 'Supplement adi gir.'); return; }
    const result = await logSupplement(customName.trim(), customAmount.trim() || '1 adet');
    setCustomName(''); setCustomAmount('');
    load();
    Alert.alert('Kaydedildi', `${customName} — ${result.note}`);
  };

  const handleDelete = (log: SupplementLog) => {
    Alert.alert('Sil', `"${log.supplement_name}" silinsin mi?`, [
      { text: 'Iptal' },
      { text: 'Sil', style: 'destructive', onPress: async () => { await deleteSupplementLog(log.id); load(); } },
    ]);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={COLORS.primary} />}
    >
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Supplement Takibi</Text>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.lg }}>
        Takviyelerini kaydet. Protein tozu ve BCAA kalori olarak sayilir.
      </Text>

      {/* Drug interaction warning (Spec 5.6) */}
      {interactionWarning && (
        <Card accentColor={COLORS.warning}>
          <Text style={{ color: COLORS.warning, fontSize: FONT.sm, fontWeight: '600', marginBottom: 4 }}>Etkilesim Uyarisi</Text>
          <Text style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 20 }}>{interactionWarning}</Text>
        </Card>
      )}

      {/* Daily totals */}
      {(totals.totalCalories > 0 || totals.totalProtein > 0) && (
        <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
          <View style={{ flex: 1, backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.sm, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border }}>
            <Text style={{ color: COLORS.primary, fontSize: FONT.lg, fontWeight: '700' }}>{totals.totalCalories}</Text>
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>kcal (sup)</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.sm, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border }}>
            <Text style={{ color: COLORS.protein, fontSize: FONT.lg, fontWeight: '700' }}>{totals.totalProtein}g</Text>
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>protein (sup)</Text>
          </View>
        </View>
      )}

      {/* Quick presets */}
      <Card title="Hizli Ekle">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
          {QUICK_SUPPS.map((s, i) => (
            <TouchableOpacity key={i} onPress={() => handleQuickAdd(s)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: SPACING.xxs,
                paddingVertical: SPACING.xs, paddingHorizontal: SPACING.sm,
                borderRadius: RADIUS.sm, backgroundColor: COLORS.surfaceLight,
                borderWidth: 1, borderColor: COLORS.border,
              }}>
              <Text style={{ fontSize: 14 }}>{s.emoji}</Text>
              <View>
                <Text style={{ color: COLORS.text, fontSize: FONT.xs }}>{s.name}</Text>
                <Text style={{ color: COLORS.textMuted, fontSize: 9 }}>{s.cal}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </Card>

      {/* Custom entry */}
      <Card title="Ozel Takviye">
        <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
          <View style={{ flex: 2 }}><Input placeholder="Takviye adi" value={customName} onChangeText={setCustomName} /></View>
          <View style={{ flex: 1 }}><Input placeholder="Miktar" value={customAmount} onChangeText={setCustomAmount} /></View>
        </View>
        <Button title="Ekle" size="sm" onPress={handleCustomAdd} />
      </Card>

      {/* Today's logs */}
      <Card title={`Bugunun Kayitlari (${logs.length})`}>
        {logs.length === 0 ? (
          <EmptyState message="Bugun supplement kaydi yok." />
        ) : (
          logs.map(l => (
            <TouchableOpacity key={l.id} onLongPress={() => handleDelete(l)}
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{l.supplement_name}</Text>
                <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{l.amount}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                {(l.calories ?? 0) > 0 && <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '600' }}>{l.calories} kcal</Text>}
                {(l.protein_g ?? 0) > 0 && <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{l.protein_g}g pro</Text>}
              </View>
            </TouchableOpacity>
          ))
        )}
      </Card>

      <Text style={{ color: COLORS.textMuted, fontSize: 10, textAlign: 'center', marginTop: SPACING.md }}>
        Uzun bas: kaydi sil · Kreatin sivi tutulumu yapabilir (tartiyi etkiler)
      </Text>
    </ScrollView>
  );
}
