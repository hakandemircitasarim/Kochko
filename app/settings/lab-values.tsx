import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT_SIZE } from '@/lib/constants';

interface LabEntry {
  id: string;
  parameter_name: string;
  value: number;
  unit: string;
  reference_min: number | null;
  reference_max: number | null;
  measured_at: string;
}

const COMMON_PARAMS = [
  { name: 'Açlık Kan Şekeri', unit: 'mg/dL', refMin: 70, refMax: 100 },
  { name: 'HbA1c', unit: '%', refMin: 4.0, refMax: 5.6 },
  { name: 'Total Kolesterol', unit: 'mg/dL', refMin: 0, refMax: 200 },
  { name: 'LDL', unit: 'mg/dL', refMin: 0, refMax: 130 },
  { name: 'HDL', unit: 'mg/dL', refMin: 40, refMax: 999 },
  { name: 'Trigliserit', unit: 'mg/dL', refMin: 0, refMax: 150 },
  { name: 'TSH', unit: 'mIU/L', refMin: 0.4, refMax: 4.0 },
  { name: 'Vitamin D', unit: 'ng/mL', refMin: 30, refMax: 100 },
  { name: 'Vitamin B12', unit: 'pg/mL', refMin: 200, refMax: 900 },
  { name: 'Ferritin', unit: 'ng/mL', refMin: 12, refMax: 300 },
  { name: 'Demir', unit: 'ug/dL', refMin: 60, refMax: 170 },
];

export default function LabValuesScreen() {
  const user = useAuthStore((s) => s.user);
  const [entries, setEntries] = useState<LabEntry[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [paramName, setParamName] = useState('');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('');
  const [refMin, setRefMin] = useState('');
  const [refMax, setRefMax] = useState('');
  const [measuredAt, setMeasuredAt] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadEntries();
  }, [user?.id]);

  async function loadEntries() {
    if (!user?.id) return;
    const { data } = await supabase
      .from('lab_values')
      .select('*')
      .eq('user_id', user.id)
      .order('measured_at', { ascending: false });
    setEntries((data as LabEntry[]) ?? []);
    setLoading(false);
  }

  const selectCommonParam = (param: typeof COMMON_PARAMS[0]) => {
    setParamName(param.name);
    setUnit(param.unit);
    setRefMin(param.refMin.toString());
    setRefMax(param.refMax.toString());
  };

  const handleAdd = async () => {
    if (!user?.id || !paramName.trim() || !value.trim()) {
      Alert.alert('Hata', 'Parametre adı ve değeri girin.');
      return;
    }

    const { error } = await supabase.from('lab_values').insert({
      user_id: user.id,
      parameter_name: paramName.trim(),
      value: parseFloat(value),
      unit: unit.trim() || '-',
      reference_min: refMin ? parseFloat(refMin) : null,
      reference_max: refMax ? parseFloat(refMax) : null,
      measured_at: measuredAt,
    });

    if (error) {
      Alert.alert('Hata', error.message);
    } else {
      setShowAdd(false);
      setParamName('');
      setValue('');
      setUnit('');
      setRefMin('');
      setRefMax('');
      loadEntries();
    }
  };

  const handleDelete = async (id: string) => {
    await supabase.from('lab_values').delete().eq('id', id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const isOutOfRange = (entry: LabEntry) => {
    if (entry.reference_min !== null && entry.value < entry.reference_min) return true;
    if (entry.reference_max !== null && entry.value > entry.reference_max) return true;
    return false;
  };

  // Group by parameter
  const grouped = entries.reduce<Record<string, LabEntry[]>>((acc, e) => {
    if (!acc[e.parameter_name]) acc[e.parameter_name] = [];
    acc[e.parameter_name].push(e);
    return acc;
  }, {});

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Lab Değerleri</Text>
      <Text style={styles.disclaimer}>
        Bu veriler yaşam tarzı takibi içindir. Tıbbi yorumlama için doktorunuza danışın.
      </Text>

      <Button
        title={showAdd ? 'İptal' : 'Yeni Değer Ekle'}
        variant={showAdd ? 'ghost' : 'primary'}
        onPress={() => setShowAdd(!showAdd)}
      />

      {showAdd && (
        <Card style={{ marginTop: SPACING.md }}>
          <Text style={styles.sectionLabel}>Hızlı Seçim</Text>
          <View style={styles.quickParams}>
            {COMMON_PARAMS.map((p) => (
              <TouchableOpacity
                key={p.name}
                style={[styles.quickChip, paramName === p.name && styles.quickChipActive]}
                onPress={() => selectCommonParam(p)}
              >
                <Text style={[styles.quickChipText, paramName === p.name && { color: '#fff' }]}>
                  {p.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Input label="Parametre" placeholder="Örn: Vitamin D" value={paramName} onChangeText={setParamName} />
          <View style={styles.row}>
            <View style={styles.flex2}><Input label="Değer" placeholder="45" value={value} onChangeText={setValue} keyboardType="decimal-pad" /></View>
            <View style={styles.flex1}><Input label="Birim" placeholder="ng/mL" value={unit} onChangeText={setUnit} /></View>
          </View>
          <View style={styles.row}>
            <View style={styles.flex1}><Input label="Ref Min" placeholder="30" value={refMin} onChangeText={setRefMin} keyboardType="decimal-pad" /></View>
            <View style={styles.flex1}><Input label="Ref Max" placeholder="100" value={refMax} onChangeText={setRefMax} keyboardType="decimal-pad" /></View>
          </View>
          <Input label="Tarih" placeholder="2024-01-15" value={measuredAt} onChangeText={setMeasuredAt} />
          <Button title="Kaydet" onPress={handleAdd} />
        </Card>
      )}

      {/* Entries grouped by parameter */}
      {Object.entries(grouped).map(([param, values]) => (
        <Card key={param} title={param} style={{ marginTop: SPACING.md }}>
          {values.map((entry) => {
            const outOfRange = isOutOfRange(entry);
            return (
              <View key={entry.id} style={styles.entryRow}>
                <Text style={styles.entryDate}>
                  {new Date(entry.measured_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: '2-digit' })}
                </Text>
                <Text style={[styles.entryValue, outOfRange && { color: COLORS.error }]}>
                  {entry.value} {entry.unit}
                </Text>
                {entry.reference_min !== null && entry.reference_max !== null && (
                  <Text style={styles.entryRef}>
                    ({entry.reference_min}-{entry.reference_max})
                  </Text>
                )}
                {outOfRange && <Text style={styles.outBadge}>!</Text>}
                <TouchableOpacity onPress={() => handleDelete(entry.id)}>
                  <Text style={styles.deleteBtn}>Sil</Text>
                </TouchableOpacity>
              </View>
            );
          })}
          {values.some(isOutOfRange) && (
            <Text style={styles.referralNote}>
              Referans dışı değer var. Bir sağlık profesyoneline danışmanızı öneririz.
            </Text>
          )}
        </Card>
      ))}

      {entries.length === 0 && !loading && (
        <Text style={styles.emptyText}>Henüz lab değeri eklenmemiş.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  title: { fontSize: FONT_SIZE.xxl, fontWeight: '800', color: COLORS.text },
  disclaimer: { fontSize: FONT_SIZE.sm, color: COLORS.warning, marginTop: SPACING.xs, marginBottom: SPACING.lg, lineHeight: 20 },
  sectionLabel: { color: COLORS.textSecondary, fontSize: FONT_SIZE.xs, fontWeight: '600', marginBottom: SPACING.sm, textTransform: 'uppercase' },
  quickParams: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.md },
  quickChip: { paddingVertical: 4, paddingHorizontal: SPACING.sm, borderRadius: 6, borderWidth: 1, borderColor: COLORS.border },
  quickChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  quickChipText: { color: COLORS.textSecondary, fontSize: FONT_SIZE.xs },
  row: { flexDirection: 'row', gap: SPACING.sm },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
  entryRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm, gap: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  entryDate: { color: COLORS.textSecondary, fontSize: FONT_SIZE.sm, width: 70 },
  entryValue: { color: COLORS.text, fontSize: FONT_SIZE.md, fontWeight: '600', flex: 1 },
  entryRef: { color: COLORS.textMuted, fontSize: FONT_SIZE.xs },
  outBadge: { color: COLORS.error, fontSize: FONT_SIZE.lg, fontWeight: '800' },
  deleteBtn: { color: COLORS.error, fontSize: FONT_SIZE.sm },
  referralNote: { color: COLORS.warning, fontSize: FONT_SIZE.xs, marginTop: SPACING.sm, fontStyle: 'italic' },
  emptyText: { color: COLORS.textMuted, fontSize: FONT_SIZE.sm, textAlign: 'center', marginTop: SPACING.xxl },
});
