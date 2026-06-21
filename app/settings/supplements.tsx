import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTodaySupplements, logSupplement, type SupplementLog } from '@/services/supplements.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { haptics } from '@/lib/haptics';

const QUICK_SUPPS = [
  { name: 'Protein Tozu', amount: '1 ölçü' }, // FIX (audit diakritik)
  { name: 'Kreatin', amount: '5g' },
  { name: 'Omega-3', amount: '1 kapsül' }, // FIX (audit diakritik)
  { name: 'Vitamin D', amount: '1 tablet' },
  { name: 'Multivitamin', amount: '1 tablet' },
  { name: 'BCAA', amount: '1 ölçü' }, // FIX (audit diakritik)
  { name: 'Magnezyum', amount: '1 tablet' },
  { name: 'Zinc', amount: '1 tablet' },
];

export default function SupplementsScreen() {
  const insets = useSafeAreaInsets();
  const [logs, setLogs] = useState<SupplementLog[]>([]);
  // FIX (audit UI-STA-03): yükleme durumu — ilk fetch bitene kadar yanlış 'kayıt yok' metni gösterilmiyordu.
  const [loading, setLoading] = useState(true);
  const [customName, setCustomName] = useState('');
  const [customAmount, setCustomAmount] = useState('');

  useEffect(() => { getTodaySupplements().then(setLogs).finally(() => setLoading(false)); }, []);

  const handleQuickAdd = async (name: string, amount: string) => {
    const { error } = await logSupplement(name, amount);
    // FIX (audit error-message-sweep): ham hata metnini gösterme; sabit Türkçe mesaj + konsola teknik detay.
    if (error) { console.error('logSupplement error', error); haptics.error(); Alert.alert('Kaydedilemedi', 'Takviye kaydedilemedi, lütfen tekrar dene.'); return; }
    haptics.success();
    getTodaySupplements().then(setLogs);
  };

  const handleCustomAdd = async () => {
    if (!customName.trim()) return;
    const { error } = await logSupplement(customName.trim(), customAmount.trim() || '1');
    // FIX (audit error-message-sweep): ham hata metnini gösterme; sabit Türkçe mesaj + konsola teknik detay.
    if (error) { console.error('logSupplement error', error); haptics.error(); Alert.alert('Kaydedilemedi', 'Takviye kaydedilemedi, lütfen tekrar dene.'); return; }
    haptics.success();
    setCustomName(''); setCustomAmount('');
    getTodaySupplements().then(setLogs);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
      {/* FIX (audit duplicate-title): Native header renders the title; in-body H1 removed as redundant. */}

      {/* Quick Add */}
      <Card title="Hızlı Ekle">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
          {QUICK_SUPPS.map((s, i) => (
            <TouchableOpacity key={i} onPress={() => { haptics.tap(); handleQuickAdd(s.name, s.amount); }}
              accessibilityRole="button"
              accessibilityLabel={`${s.name} ekle`}
              style={{ paddingVertical: 6, paddingHorizontal: SPACING.sm, borderRadius: 8, backgroundColor: COLORS.surfaceLight }}>
              <Text style={{ color: COLORS.text, fontSize: FONT.xs }}>{s.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Card>

      {/* Custom */}
      <Card title="Özel Ekle">
        <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
          <View style={{ flex: 2 }}><Input placeholder="Supplement adı" value={customName} onChangeText={setCustomName} returnKeyType="next" /></View>
          <View style={{ flex: 1 }}><Input placeholder="Miktar" value={customAmount} onChangeText={setCustomAmount} returnKeyType="done" onSubmitEditing={handleCustomAdd} /></View>
        </View>
        <Button title="Ekle" size="md" onPress={handleCustomAdd} />
      </Card>

      {/* Today's Logs */}
      <Card title={`Bugünün Kayıtları (${logs.length})`}>
        {/* FIX (audit UI-STA-03): ilk fetch sürerken 'kayıt yok' yerine yükleniyor göstergesi. */}
        {loading ? (
          <View style={{ paddingVertical: SPACING.md, alignItems: 'center' }}>
            <ActivityIndicator color={COLORS.primary} />
          </View>
        ) : logs.length === 0 ? (
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.md }}>Bugün supplement kaydı yok.</Text>
        ) : (
          logs.map(l => (
            <View key={l.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.xs, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
              <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{l.supplement_name}</Text>
              <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>{l.amount}</Text>
                {l.calories > 0 && <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm }}>{l.calories} kcal</Text>}
              </View>
            </View>
          ))
        )}
      </Card>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
