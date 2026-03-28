import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { getTodaySupplements, logSupplement, type SupplementLog } from '@/services/supplements.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const QUICK_SUPPS = [
  { name: 'Protein Tozu', amount: '1 olcu' },
  { name: 'Kreatin', amount: '5g' },
  { name: 'Omega-3', amount: '1 kapsul' },
  { name: 'Vitamin D', amount: '1 tablet' },
  { name: 'Multivitamin', amount: '1 tablet' },
  { name: 'BCAA', amount: '1 olcu' },
  { name: 'Magnezyum', amount: '1 tablet' },
  { name: 'Zinc', amount: '1 tablet' },
];

export default function SupplementsScreen() {
  const [logs, setLogs] = useState<SupplementLog[]>([]);
  const [customName, setCustomName] = useState('');
  const [customAmount, setCustomAmount] = useState('');

  useEffect(() => { getTodaySupplements().then(setLogs); }, []);

  const handleQuickAdd = async (name: string, amount: string) => {
    await logSupplement(name, amount);
    getTodaySupplements().then(setLogs);
  };

  const handleCustomAdd = async () => {
    if (!customName.trim()) return;
    await logSupplement(customName.trim(), customAmount.trim() || '1');
    setCustomName(''); setCustomAmount('');
    getTodaySupplements().then(setLogs);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Supplement Takibi</Text>

      {/* Quick Add */}
      <Card title="Hizli Ekle">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
          {QUICK_SUPPS.map((s, i) => (
            <TouchableOpacity key={i} onPress={() => handleQuickAdd(s.name, s.amount)}
              style={{ paddingVertical: 6, paddingHorizontal: SPACING.sm, borderRadius: 8, backgroundColor: COLORS.surfaceLight }}>
              <Text style={{ color: COLORS.text, fontSize: FONT.xs }}>{s.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Card>

      {/* Custom */}
      <Card title="Ozel Ekle">
        <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
          <View style={{ flex: 2 }}><Input placeholder="Supplement adi" value={customName} onChangeText={setCustomName} /></View>
          <View style={{ flex: 1 }}><Input placeholder="Miktar" value={customAmount} onChangeText={setCustomAmount} /></View>
        </View>
        <Button title="Ekle" size="sm" onPress={handleCustomAdd} />
      </Card>

      {/* Today's Logs */}
      <Card title={`Bugunun Kayitlari (${logs.length})`}>
        {logs.length === 0 ? (
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.md }}>Bugun supplement kaydi yok.</Text>
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
  );
}
