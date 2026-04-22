import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getHealthEvents, addHealthEvent, type HealthEvent } from '@/services/health.service';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const EVENT_TYPES = ['surgery', 'injury', 'illness', 'medication', 'allergy', 'other'];
const EVENT_LABELS: Record<string, string> = { surgery: 'Ameliyat', injury: 'Sakatlık', illness: 'Hastalık', medication: 'İlaç', allergy: 'Alerji', other: 'Diğer' };

export default function HealthEventsScreen() {
  const insets = useSafeAreaInsets();
  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [type, setType] = useState('surgery');
  const [desc, setDesc] = useState('');
  const [date, setDate] = useState('');
  const [ongoing, setOngoing] = useState(false);

  useEffect(() => { getHealthEvents().then(setEvents); }, []);

  const handleAdd = async () => {
    if (!desc.trim()) return;
    await addHealthEvent({ event_type: type, description: desc, event_date: date || null, is_ongoing: ongoing });
    setShowAdd(false); setDesc(''); setDate('');
    getHealthEvents().then(setEvents);
  };

  const handleDelete = async (id: string) => {
    await supabase.from('health_events').delete().eq('id', id);
    setEvents(prev => prev.filter(e => e.id !== id));
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Sağlık Geçmişi</Text>

      <Button title={showAdd ? 'İptal' : 'Yeni Ekle'} variant={showAdd ? 'ghost' : 'primary'} onPress={() => setShowAdd(!showAdd)} />

      {showAdd && (
        <Card style={{ marginTop: SPACING.md }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.md }}>
            {EVENT_TYPES.map(t => (
              <TouchableOpacity key={t} onPress={() => setType(t)}
                style={{ paddingVertical: 6, paddingHorizontal: SPACING.sm, borderRadius: 8, borderWidth: 1,
                  borderColor: type === t ? COLORS.primary : COLORS.border,
                  backgroundColor: type === t ? COLORS.primary : 'transparent' }}>
                <Text style={{ color: type === t ? '#fff' : COLORS.textSecondary, fontSize: FONT.xs }}>{EVENT_LABELS[t]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Input label="Açıklama" placeholder="Diz ameliyatı, 2022" value={desc} onChangeText={setDesc} multiline />
          <Input label="Tarih (opsiyonel)" placeholder="2022-06-15" value={date} onChangeText={setDate} />
          <TouchableOpacity onPress={() => setOngoing(!ongoing)} style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
            <Text style={{ color: COLORS.primary }}>{ongoing ? '[x]' : '[ ]'}</Text>
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Devam ediyor</Text>
          </TouchableOpacity>
          <Button title="Kaydet" onPress={handleAdd} />
        </Card>
      )}

      {events.map(e => (
        <TouchableOpacity key={e.id} onLongPress={() => handleDelete(e.id)}
          style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, marginTop: SPACING.sm, borderWidth: 1, borderColor: COLORS.border }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: COLORS.primary, fontSize: FONT.xs, fontWeight: '600', textTransform: 'uppercase' }}>{EVENT_LABELS[e.event_type] ?? e.event_type}</Text>
            {e.is_ongoing && <Text style={{ color: COLORS.warning, fontSize: FONT.xs }}>Devam ediyor</Text>}
          </View>
          <Text style={{ color: COLORS.text, fontSize: FONT.md, marginTop: 4 }}>{e.description}</Text>
          {e.event_date && <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 2 }}>{e.event_date}</Text>}
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}
