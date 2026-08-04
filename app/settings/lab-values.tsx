import { Ionicons } from '@expo/vector-icons';
import { DateTimeField } from '@/components/ui/DateTimeField';
import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator, KeyboardAvoidingView } from 'react-native';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { addLabValue, COMMON_LAB_PARAMS, type LabValue } from '@/services/health.service';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { SPACING, FONT } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { useTheme } from '@/lib/theme';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';

export default function LabValuesScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const [entries, setEntries] = useState<LabValue[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [paramName, setParamName] = useState('');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('');
  // ux-sweep (LV-02): ölçüm tarihi sorulmadan bugüne sabitleniyordu — eski tahlil girilemiyordu.
  const [measuredAt, setMeasuredAt] = useState('');
  const [refMin, setRefMin] = useState('');
  const [refMax, setRefMax] = useState('');
  // FIX (audit UI-STA-03): yükleme durumu — ilk fetch bitene kadar veri olan kullanıcıya yanlış 'boş' kartı gösterilmiyordu (food-preferences kalıbı).
  const [loading, setLoading] = useState(true);
  // FIX (audit empty-vs-error): getLabValues swallows errors into [] — the screen queries
  // directly so a fetch failure renders an error+retry card, not 'Henüz lab değerin yok'.
  const [loadError, setLoadError] = useState(false);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const { data, error } = await supabase.from('lab_values').select('*').order('measured_at', { ascending: false });
    if (error) {
      console.warn('lab_values load failed', error);
      setLoadError(true);
    } else {
      setEntries((data ?? []) as LabValue[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadEntries(); }, [loadEntries]);

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
      measured_at: measuredAt || new Date().toISOString().split('T')[0],
    });
    if (!ok) {
      haptics.error();
      Alert.alert('Kaydedilemedi', 'Değer eklenemedi, lütfen tekrar dene.');
      return;
    }
    haptics.success();
    setShowAdd(false); setParamName(''); setValue(''); setUnit(''); setRefMin(''); setRefMax('');
    loadEntries();
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
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding">
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
      {/* Native header (settings/_layout.tsx) already shows the Turkish "Lab Değerleri" title — redundant body heading dropped, disclaimer kept as the screen intro. */}
      <Text style={{ ...TYPE.body, color: colors.warning, marginBottom: SPACING.lg }}>Yaşam tarzı takibi içindir. Tıbbi yorum için doktoruna danış.</Text>

      <Button title={showAdd ? 'İptal' : 'Yeni Değer Ekle'} variant={showAdd ? 'ghost' : 'primary'} onPress={() => setShowAdd(!showAdd)} />

      {showAdd && (
        <Card style={{ marginTop: SPACING.md }}>
          <Text style={{ color: colors.textSecondary, ...TYPE.caption, fontWeight: '600', marginBottom: SPACING.sm }}>Hızlı Seçim</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.md }}>
            {COMMON_LAB_PARAMS.map(p => {
              const selected = paramName === p.name;
              return (
                <TouchableOpacity key={p.name} onPress={() => { haptics.tap(); selectParam(p); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={p.name}
                  style={{ paddingVertical: 4, paddingHorizontal: SPACING.sm, borderRadius: 6, borderWidth: 1,
                    borderColor: selected ? colors.primary : colors.border,
                    backgroundColor: selected ? colors.primary : 'transparent' }}>
                  <Text style={{ color: selected ? getContrastColor(colors.primary) : colors.textSecondary, ...TYPE.caption }}>{p.name}</Text>
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
          <DateTimeField label="Ölçüm Tarihi (boşsa bugün)" mode="date" value={measuredAt} onChange={setMeasuredAt} placeholder="2026-07-30" maximumDate={new Date()} />
          <Button title="Kaydet" onPress={handleAdd} />
        </Card>
      )}

      {Object.entries(grouped).map(([param, values]) => (
        <Card key={param} title={param} style={{ marginTop: SPACING.md }}>
          {values.map(e => (
            <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.xs, gap: SPACING.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ color: colors.textSecondary, ...TYPE.body, width: 60 }}>
                {new Date(e.measured_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
              </Text>
              <Text style={{ color: e.is_out_of_range ? colors.error : colors.text, ...TYPE.headline, flex: 1 }}>{e.value} {e.unit}</Text>
              {e.is_out_of_range && <Text style={{ color: colors.error, ...TYPE.title3 }}>!</Text>}
              {/* ux-sweep (LV-01): yanlış girilen değerin hiçbir silme yolu yoktu. */}
              <TouchableOpacity
                onPress={() => {
                  Alert.alert('Sil', `${param} · ${e.value} ${e.unit} silinsin mi?`, [
                    { text: 'İptal', style: 'cancel' },
                    { text: 'Sil', style: 'destructive', onPress: async () => {
                      const { error } = await supabase.from('lab_values').delete().eq('id', e.id);
                      if (error) { Alert.alert('Hata', 'Silinemedi, tekrar dene.'); return; }
                      loadEntries();
                    }},
                  ]);
                }}
                accessibilityRole="button" accessibilityLabel={`${param} değerini sil`}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          ))}
          {values.some(v => v.is_out_of_range) && (
            <Text style={{ color: colors.warning, ...TYPE.caption, marginTop: SPACING.sm }}>Referans dışı değer var. Sağlık profesyoneline danış.</Text>
          )}
        </Card>
      ))}

      {/* FIX (audit UI-STA-03): ilk fetch sürerken boş-durum kartı yerine yükleniyor göstergesi. */}
      {loading && Object.keys(grouped).length === 0 && (
        <View style={{ gap: SPACING.md, paddingTop: SPACING.md }}>
          <SkeletonCard lines={3} />
          <SkeletonCard lines={2} />
        </View>
      )}

      {/* FIX (audit empty-vs-error): fetch hatası kendinden emin boş-durum yerine hata+tekrar dene kartı (shared LoadErrorState). */}
      {!loading && loadError && (
        <Card style={{ marginTop: SPACING.md }}>
          <LoadErrorState embedded title="Lab değerleri yüklenemedi" onRetry={loadEntries} />
        </Card>
      )}

      {/* FIX (audit UI-SET-04): kayıt yokken (ve form kapalıyken) açıklayıcı boş-durum kartı; kardeş liste ekranları gibi. */}
      {!loading && !loadError && Object.keys(grouped).length === 0 && !showAdd && (
        <Card style={{ marginTop: SPACING.md }}>
          <Text style={{ color: colors.text, ...TYPE.headline, textAlign: 'center' }}>Henüz lab değerin yok</Text>
          <Text style={{ color: colors.textMuted, ...TYPE.body, textAlign: 'center', marginTop: SPACING.xs }}>Vitamin D, B12, ferritin gibi tahlil sonuçlarını ekle; koçun planı bu değerlere göre uyarlar.</Text>
        </Card>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
