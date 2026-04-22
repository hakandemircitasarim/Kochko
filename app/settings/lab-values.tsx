import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { getLabValues, addLabValue, COMMON_LAB_PARAMS, type LabValue } from '@/services/health.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function LabValuesScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const [entries, setEntries] = useState<LabValue[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [paramName, setParamName] = useState('');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('');
  const [refMin, setRefMin] = useState('');
  const [refMax, setRefMax] = useState('');

  useEffect(() => { getLabValues().then(setEntries); }, []);

  const selectParam = (p: typeof COMMON_LAB_PARAMS[0]) => {
    setParamName(p.name); setUnit(p.unit); setRefMin(String(p.refMin)); setRefMax(String(p.refMax));
  };

  const handleAdd = async () => {
    if (!paramName.trim() || !value.trim()) return;
    await addLabValue({
      parameter_name: paramName, value: parseFloat(value), unit: unit || '-',
      reference_min: refMin ? parseFloat(refMin) : null, reference_max: refMax ? parseFloat(refMax) : null,
      measured_at: new Date().toISOString().split('T')[0],
    });
    setShowAdd(false); setParamName(''); setValue(''); setUnit(''); setRefMin(''); setRefMax('');
    getLabValues().then(setEntries);
  };

  // Group by parameter
  const grouped = entries.reduce<Record<string, LabValue[]>>((acc, e) => {
    if (!acc[e.parameter_name]) acc[e.parameter_name] = [];
    acc[e.parameter_name].push(e);
    return acc;
  }, {});

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text }}>Lab Değerleri</Text>
      <Text style={{ fontSize: FONT.sm, color: COLORS.warning, marginTop: SPACING.xs, marginBottom: SPACING.lg }}>Yaşam tarzı takibi içindir. Tıbbi yorum için doktoruna danış.</Text>

      <Button title={showAdd ? 'İptal' : 'Yeni Değer Ekle'} variant={showAdd ? 'ghost' : 'primary'} onPress={() => setShowAdd(!showAdd)} />

      {showAdd && (
        <Card style={{ marginTop: SPACING.md }}>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginBottom: SPACING.sm }}>Hızlı Seçim</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.md }}>
            {COMMON_LAB_PARAMS.map(p => (
              <TouchableOpacity key={p.name} onPress={() => selectParam(p)}
                style={{ paddingVertical: 4, paddingHorizontal: SPACING.sm, borderRadius: 6, borderWidth: 1,
                  borderColor: paramName === p.name ? COLORS.primary : COLORS.border,
                  backgroundColor: paramName === p.name ? COLORS.primary : 'transparent' }}>
                <Text style={{ color: paramName === p.name ? '#fff' : COLORS.textSecondary, fontSize: FONT.xs }}>{p.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Input label="Parametre" value={paramName} onChangeText={setParamName} placeholder="Vitamin D" />
          <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
            <View style={{ flex: 2 }}><Input label="Değer" value={value} onChangeText={setValue} keyboardType="decimal-pad" placeholder="45" /></View>
            <View style={{ flex: 1 }}><Input label="Birim" value={unit} onChangeText={setUnit} placeholder="ng/mL" /></View>
          </View>
          <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
            <View style={{ flex: 1 }}><Input label="Ref Min" value={refMin} onChangeText={setRefMin} keyboardType="decimal-pad" /></View>
            <View style={{ flex: 1 }}><Input label="Ref Max" value={refMax} onChangeText={setRefMax} keyboardType="decimal-pad" /></View>
          </View>
          <Button title="Kaydet" onPress={handleAdd} />
        </Card>
      )}

      {Object.entries(grouped).map(([param, values]) => (
        <Card key={param} title={param} style={{ marginTop: SPACING.md }}>
          {values.map(e => (
            <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.xs, gap: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
              <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, width: 60 }}>
                {new Date(e.measured_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
              </Text>
              <Text style={{ color: e.is_out_of_range ? COLORS.error : COLORS.text, fontSize: FONT.md, fontWeight: '600', flex: 1 }}>{e.value} {e.unit}</Text>
              {e.is_out_of_range && <Text style={{ color: COLORS.error, fontSize: FONT.lg, fontWeight: '800' }}>!</Text>}
            </View>
          ))}
          {values.some(v => v.is_out_of_range) && (
            <Text style={{ color: COLORS.warning, fontSize: FONT.xs, marginTop: SPACING.sm }}>Referans dışı değer var. Sağlık profesyoneline danış.</Text>
          )}
        </Card>
      ))}
    </ScrollView>
  );
}
