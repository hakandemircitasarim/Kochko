import { getEffectiveDate } from '@/lib/day-boundary';
import { useProfileStore } from '@/stores/profile.store';
import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator, KeyboardAvoidingView, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { logSupplement, type SupplementLog } from '@/services/supplements.service';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { SPACING, FONT } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { useTheme } from '@/lib/theme';
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
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const dayBoundaryHour = useProfileStore(st => (st.profile?.day_boundary_hour as number) ?? 4);
  const [logs, setLogs] = useState<SupplementLog[]>([]);
  // FIX (audit UI-STA-03): yükleme durumu — ilk fetch bitene kadar yanlış 'kayıt yok' metni gösterilmiyordu.
  const [loading, setLoading] = useState(true);
  // FIX (audit empty-vs-error): getTodaySupplements hataları []'a yutuyor — ekran doğrudan
  // sorguluyor ki fetch hatası 'kayıt yok' yerine hata+tekrar dene kartı çizsin.
  const [loadError, setLoadError] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  // FIX (ux-round3 #7): "İleri" from the name field jumps to the amount field.
  const amountRef = useRef<TextInput>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    // ux-sweep (SU-01): UTC günü gece 00-03 arası Türkiye'de YANLIŞ güne yazıyordu — uygulama
    // genelindeki efektif gün (getEffectiveDate + day_boundary_hour) burada da geçerli.
    const date = getEffectiveDate(new Date(), dayBoundaryHour);
    const { data, error } = await supabase.from('supplement_logs').select('*').eq('logged_for_date', date).order('logged_at');
    if (error) {
      console.warn('supplement_logs load failed', error);
      setLoadError(true);
    } else {
      setLogs((data ?? []) as SupplementLog[]);
    }
    setLoading(false);
  }, [dayBoundaryHour]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const handleQuickAdd = async (name: string, amount: string) => {
    const { error } = await logSupplement(name, amount);
    // FIX (audit error-message-sweep): ham hata metnini gösterme; sabit Türkçe mesaj + konsola teknik detay.
    if (error) { console.error('logSupplement error', error); haptics.error(); Alert.alert('Kaydedilemedi', 'Takviye kaydedilemedi, lütfen tekrar dene.'); return; }
    haptics.success();
    loadLogs();
  };

  const handleCustomAdd = async () => {
    if (!customName.trim()) return;
    const { error } = await logSupplement(customName.trim(), customAmount.trim() || '1');
    // FIX (audit error-message-sweep): ham hata metnini gösterme; sabit Türkçe mesaj + konsola teknik detay.
    if (error) { console.error('logSupplement error', error); haptics.error(); Alert.alert('Kaydedilemedi', 'Takviye kaydedilemedi, lütfen tekrar dene.'); return; }
    haptics.success();
    setCustomName(''); setCustomAmount('');
    loadLogs();
  };

  // FIX (ux-round3 #13): the quick-add chips are one-tap writes with no way to undo — a mis-tap
  // creates a permanent log (and calorie-bearing supps pollute the day's calorie tracking). Add a
  // confirmed delete per row (mirrors food-preferences' pattern).
  const handleDelete = (l: SupplementLog) => {
    Alert.alert('Kaydı sil', `"${l.supplement_name}" kaydını silmek istediğine emin misin?`, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil', style: 'destructive', onPress: async () => {
          const { error } = await supabase.from('supplement_logs').delete().eq('id', l.id);
          if (error) { haptics.error(); Alert.alert('Silinemedi', 'Kayıt silinemedi, lütfen tekrar dene.'); return; }
          haptics.success();
          loadLogs();
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding">
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
      {/* FIX (audit duplicate-title): Native header renders the title; in-body H1 removed as redundant. */}

      {/* Quick Add */}
      <Card title="Hızlı Ekle">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
          {QUICK_SUPPS.map((s, i) => (
            <TouchableOpacity key={i} onPress={() => { haptics.tap(); handleQuickAdd(s.name, s.amount); }}
              accessibilityRole="button"
              accessibilityLabel={`${s.name} ekle`}
              style={{ paddingVertical: 6, paddingHorizontal: SPACING.sm, borderRadius: 8, backgroundColor: colors.surfaceLight }}>
              <Text style={{ color: colors.text, ...TYPE.caption }}>{s.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Card>

      {/* Custom */}
      <Card title="Özel Ekle">
        <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
          <View style={{ flex: 2 }}><Input placeholder="Supplement adı" value={customName} onChangeText={setCustomName} returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => amountRef.current?.focus()} /></View>
          <View style={{ flex: 1 }}><Input ref={amountRef} placeholder="Miktar" value={customAmount} onChangeText={setCustomAmount} returnKeyType="done" onSubmitEditing={handleCustomAdd} /></View>
        </View>
        <Button title="Ekle" size="md" onPress={handleCustomAdd} />
      </Card>

      {/* Today's Logs */}
      <Card title={`Bugünün Kayıtları (${logs.length})`}>
        {/* FIX (audit UI-STA-03): ilk fetch sürerken 'kayıt yok' yerine yükleniyor göstergesi. */}
        {loading ? (
          <View style={{ paddingVertical: SPACING.md, alignItems: 'center' }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : loadError ? (
          /* FIX (audit empty-vs-error): fetch hatası 'kayıt yok' değil, hata+tekrar dene (shared LoadErrorState). */
          <LoadErrorState embedded title="Kayıtlar yüklenemedi" onRetry={loadLogs} />
        ) : logs.length === 0 ? (
          <Text style={{ color: colors.textMuted, ...TYPE.body, textAlign: 'center', paddingVertical: SPACING.md }}>Bugün supplement kaydı yok.</Text>
        ) : (
          logs.map(l => (
            <View key={l.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.xs, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ color: colors.text, ...TYPE.body, flex: 1 }}>{l.supplement_name}</Text>
              <View style={{ flexDirection: 'row', gap: SPACING.sm, alignItems: 'center' }}>
                <Text style={{ color: colors.textSecondary, ...TYPE.body }}>{l.amount}</Text>
                {l.calories > 0 && <Text style={{ color: colors.textMuted, ...TYPE.body }}>{l.calories} kcal</Text>}
                <TouchableOpacity onPress={() => handleDelete(l)} accessibilityRole="button" accessibilityLabel={`${l.supplement_name} kaydını sil`} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </Card>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
