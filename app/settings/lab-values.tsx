import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { getLabValues, addLabValue, COMMON_LAB_PARAMS, type LabValue } from '@/services/health.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';

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
  // FIX (audit UI-STA-03): yükleme durumu — ilk fetch bitene kadar veri olan kullanıcıya yanlış 'boş' kartı gösterilmiyordu (food-preferences kalıbı).
  const [loading, setLoading] = useState(true);

  useEffect(() => { getLabValues().then(setEntries).finally(() => setLoading(false)); }, []);

  const selectParam = (p: typeof COMMON_LAB_PARAMS[0]) => {
    setParamName(p.name); setUnit(p.unit); setRefMin(String(p.refMin)); setRefMax(String(p.refMax));
  };

  const handleAdd = async () => {
    if (!paramName.trim() || !value.trim()) return;
    // FIX (audit lab-values-screen): 'Değer' alanında sayısal doğrulama —
    // 'yüksek'→NaN, '45 ng'→45 sessizce geçip DB'ye bozuk veri yazıyordu.
    const n = parseFloat(value.replace(',', '.'));
    if (!Number.isFinite(n)) {
      haptics.error();
      Alert.alert('Geçersiz değer', 'Lütfen sayısal bir değer gir.');
      return;
    }
    // Ref Min/Max boş değilse onlar da sayısal olmalı.
    const rMin = refMin.trim() ? parseFloat(refMin.replace(',', '.')) : null;
    const rMax = refMax.trim() ? parseFloat(refMax.replace(',', '.')) : null;
    if ((refMin.trim() && !Number.isFinite(rMin as number)) || (refMax.trim() && !Number.isFinite(rMax as number))) {
      haptics.error();
      Alert.alert('Geçersiz aralık', 'Referans değerleri sayısal olmalı.');
      return;
    }
    const ok = await addLabValue({
      parameter_name: paramName, value: n, unit: unit || '-',
      reference_min: rMin, reference_max: rMax,
      measured_at: new Date().toISOString().split('T')[0],
    });
    if (!ok) {
      haptics.error();
      Alert.alert('Kaydedilemedi', 'Değer eklenemedi, lütfen tekrar dene.');
      return;
    }
    haptics.success();
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
    // FIX (audit lab-values-screen): KeyboardAvoidingView + keyboardShouldPersistTaps —
    // Ref Min/Max + Kaydet klavyenin altında kalıyordu (menstrual.tsx kalıbı).
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
      {/* Native header (settings/_layout.tsx) already shows the Turkish "Lab Değerleri" title — redundant body heading dropped, disclaimer kept as the screen intro. */}
      <Text style={{ fontSize: FONT.sm, color: COLORS.warning, marginBottom: SPACING.lg }}>Yaşam tarzı takibi içindir. Tıbbi yorum için doktoruna danış.</Text>

      <Button title={showAdd ? 'İptal' : 'Yeni Değer Ekle'} variant={showAdd ? 'ghost' : 'primary'} onPress={() => setShowAdd(!showAdd)} />

      {showAdd && (
        <Card style={{ marginTop: SPACING.md }}>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginBottom: SPACING.sm }}>Hızlı Seçim</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.md }}>
            {COMMON_LAB_PARAMS.map(p => {
              const selected = paramName === p.name;
              return (
                <TouchableOpacity key={p.name} onPress={() => { haptics.tap(); selectParam(p); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={p.name}
                  style={{ paddingVertical: 4, paddingHorizontal: SPACING.sm, borderRadius: 6, borderWidth: 1,
                    borderColor: selected ? COLORS.primary : COLORS.border,
                    backgroundColor: selected ? COLORS.primary : 'transparent' }}>
                  <Text style={{ color: selected ? getContrastColor(COLORS.primary) : COLORS.textSecondary, fontSize: FONT.xs }}>{p.name}</Text>
                </TouchableOpacity>
              );
            })}
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

      {/* FIX (audit UI-STA-03): ilk fetch sürerken boş-durum kartı yerine yükleniyor göstergesi. */}
      {loading && Object.keys(grouped).length === 0 && (
        <View style={{ paddingVertical: SPACING.xl, alignItems: 'center' }}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      )}

      {/* FIX (audit UI-SET-04): kayıt yokken (ve form kapalıyken) açıklayıcı boş-durum kartı; kardeş liste ekranları gibi. */}
      {!loading && Object.keys(grouped).length === 0 && !showAdd && (
        <Card style={{ marginTop: SPACING.md }}>
          <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600', textAlign: 'center' }}>Henüz lab değerin yok</Text>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', marginTop: SPACING.xs }}>Vitamin D, B12, ferritin gibi tahlil sonuçlarını ekle; koçun planı bu değerlere göre uyarlar.</Text>
        </Card>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
