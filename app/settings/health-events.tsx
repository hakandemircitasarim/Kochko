import { DateTimeField } from '@/components/ui/DateTimeField';
import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator, KeyboardAvoidingView } from 'react-native';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getHealthEvents, addHealthEvent, type HealthEvent } from '@/services/health.service';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { SPACING, FONT } from '@/lib/constants';
import { useTheme } from '@/lib/theme';
import { getContrastColor } from '@/lib/accessibility';

const EVENT_TYPES = ['surgery', 'injury', 'illness', 'medication', 'allergy', 'other'];
const EVENT_LABELS: Record<string, string> = { surgery: 'Ameliyat', injury: 'Sakatlık', illness: 'Hastalık', medication: 'İlaç', allergy: 'Alerji', other: 'Diğer' };

export default function HealthEventsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [type, setType] = useState('surgery');
  const [desc, setDesc] = useState('');
  const [date, setDate] = useState('');
  const [ongoing, setOngoing] = useState(false);
  // FIX (ux-pass5 UI-STA-03 + empty-vs-error): loading + error states — the confident
  // 'Henüz sağlık olayın yok' card used to render during every fetch and permanently on a
  // failed fetch (safety-critical data: alerji/ameliyat). Mirrors the lab-values.tsx fix.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setEvents(await getHealthEvents());
    } catch (err) {
      console.warn('health_events load failed', err);
      setLoadError(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const handleAdd = async () => {
    if (!desc.trim()) return;
    const ok = await addHealthEvent({ event_type: type, description: desc, event_date: date || null, is_ongoing: ongoing });
    if (!ok) {
      Alert.alert('Kaydedilemedi', 'Kayıt eklenemedi, lütfen tekrar dene.');
      return;
    }
    setShowAdd(false); setDesc(''); setDate('');
    // FIX (ux-pass5): getHealthEvents now throws on failure — route the refresh through
    // loadEvents so a failed refetch shows the error card instead of an unhandled rejection.
    loadEvents();
  };

  // FIX (audit ui-destructive-delete): yıkıcı silmeye onay diyaloğu eklendi (yanlışlıkla silmeyi önler).
  const handleDelete = (id: string) => {
    Alert.alert('Sil', 'Bu kaydı silmek istediğine emin misin?', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: async () => {
        // ux-sweep (HE-01): supabase-js hata FIRLATMAZ — error kontrolsüz + optimistic remove,
        // ağ hatasında 'sildim' görünüp yenilemede kayıt geri geliyordu. Önce yaz, sonra düşür.
        const { error } = await supabase.from('health_events').delete().eq('id', id);
        if (error) { Alert.alert('Hata', 'Kayıt silinemedi. Bağlantını kontrol edip tekrar dene.'); return; }
        setEvents(prev => prev.filter(e => e.id !== id));
      }},
    ]);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding">
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
      {/* FIX (audit ui-settings-duplicate-title): native header (settings/_layout.tsx) renders the title; in-body H1 removed as redundant. */}
      <Button title={showAdd ? 'İptal' : 'Yeni Ekle'} variant={showAdd ? 'ghost' : 'primary'} onPress={() => setShowAdd(!showAdd)} style={{ marginTop: SPACING.lg }} />

      {showAdd && (
        <Card style={{ marginTop: SPACING.md }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.md }}>
            {EVENT_TYPES.map(t => (
              // FIX (audit ui-chip-a11y): seçilebilir tür chip'ine radio rolü + selected state + label.
              <TouchableOpacity key={t} onPress={() => setType(t)}
                accessibilityRole="radio"
                accessibilityState={{ selected: type === t }}
                accessibilityLabel={EVENT_LABELS[t]}
                style={{ paddingVertical: 6, paddingHorizontal: SPACING.sm, borderRadius: 8, borderWidth: 1,
                  borderColor: type === t ? colors.primary : colors.border,
                  backgroundColor: type === t ? colors.primary : 'transparent' }}>
                {/* FIX (audit UI-STA-04): seçili chip metni '#fff' yerine getContrastColor(colors.primary) (siyah, teal üzerinde WCAG AA geçer; beyaz 3.39:1 idi). */}
                <Text style={{ color: type === t ? getContrastColor(colors.primary) : colors.textSecondary, fontSize: FONT.xs }}>{EVENT_LABELS[t]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Input label="Açıklama" placeholder="Diz ameliyatı, 2022" value={desc} onChangeText={setDesc} multiline />
          {/* ux-sweep (HE-02): serbest metin tarih doğrulamasızdı — takvim alanı ISO üretir. */}
          <DateTimeField label="Tarih (opsiyonel)" mode="date" value={date} onChange={setDate} placeholder="2022-06-15" maximumDate={new Date()} />
          {/* FIX (audit ui-toggles): onay kutusuna checkbox rolü + checked state + label. */}
          <TouchableOpacity onPress={() => setOngoing(!ongoing)} accessibilityRole="checkbox" accessibilityState={{ checked: ongoing }} accessibilityLabel="Devam ediyor" style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
            <Text style={{ color: colors.primary }}>{ongoing ? '[x]' : '[ ]'}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: FONT.sm }}>Devam ediyor</Text>
          </TouchableOpacity>
          <Button title="Kaydet" onPress={handleAdd} />
        </Card>
      )}

      {/* FIX (ux-pass5 UI-STA-03): ilk fetch sürerken boş-durum kartı yerine yükleniyor göstergesi (lab-values kalıbı). */}
      {loading && events.length === 0 && (
        <View style={{ gap: SPACING.md, paddingTop: SPACING.md }}>
          <SkeletonCard lines={3} />
          <SkeletonCard lines={2} />
        </View>
      )}

      {/* FIX (ux-pass5 empty-vs-error): fetch hatası kendinden emin boş-durum yerine hata+tekrar dene kartı (shared LoadErrorState). */}
      {!loading && loadError && (
        <Card style={{ marginTop: SPACING.md }}>
          <LoadErrorState embedded title="Sağlık olayları yüklenemedi" onRetry={loadEvents} />
        </Card>
      )}

      {/* FIX (audit UI-STA-04): boş durumda (yeni kullanıcı / kayıt yok) form altında hiçbir şey çıkmıyordu; kardeş liste ekranları gibi açıklayıcı boş-durum kartı eklendi. */}
      {/* FIX (audit UI-SET-04): form açıkken boş-durum kartını gizle (form zaten görünüyor). */}
      {!loading && !loadError && events.length === 0 && !showAdd && (
        <Card style={{ marginTop: SPACING.md }}>
          <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '600', textAlign: 'center' }}>Henüz sağlık olayın yok</Text>
          <Text style={{ color: colors.textMuted, fontSize: FONT.sm, textAlign: 'center', marginTop: SPACING.xs }}>Ameliyat, sakatlık, kronik hastalık veya alerji gibi kayıtları buraya ekle; koçun planı bunlara göre güvenli tutar.</Text>
        </Card>
      )}

      {events.map(e => (
        <TouchableOpacity key={e.id} onLongPress={() => handleDelete(e.id)}
          style={{ backgroundColor: colors.card, borderRadius: 12, padding: SPACING.md, marginTop: SPACING.sm, borderWidth: 1, borderColor: colors.border }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: colors.primary, fontSize: FONT.xs, fontWeight: '600', textTransform: 'uppercase', flex: 1 }}>{EVENT_LABELS[e.event_type] ?? e.event_type}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
              {e.is_ongoing && <Text style={{ color: colors.warning, fontSize: FONT.xs }}>Devam ediyor</Text>}
              {/* FIX (audit ui-destructive-delete): görünür/erişilebilir sil butonu (Alert onaylı); long-press kısayolu korundu. */}
              <TouchableOpacity
                onPress={() => handleDelete(e.id)}
                accessibilityRole="button"
                accessibilityLabel={`${EVENT_LABELS[e.event_type] ?? e.event_type} kaydını sil`}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={{ padding: SPACING.xs }}
              >
                <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>
          <Text style={{ color: colors.text, fontSize: FONT.md, marginTop: 4 }}>{e.description}</Text>
          {e.event_date && <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: 2 }}>{e.event_date}</Text>}
        </TouchableOpacity>
      ))}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
