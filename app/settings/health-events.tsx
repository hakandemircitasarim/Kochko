/**
 * Health Events Screen — Spec 2.1: Sağlık geçmişi
 * Structured health history: surgeries, injuries, illnesses, medications, allergies.
 * AI uses this for workout restrictions and supplement warnings.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { getHealthEvents, addHealthEvent, type HealthEvent } from '@/services/health.service';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

type EventType = 'surgery' | 'injury' | 'illness' | 'medication' | 'allergy' | 'other';

const EVENT_TYPES: { value: EventType; label: string; color: string }[] = [
  { value: 'surgery', label: 'Ameliyat', color: '#E53935' },
  { value: 'injury', label: 'Sakatlik', color: '#FB8C00' },
  { value: 'illness', label: 'Hastalik', color: '#7B1FA2' },
  { value: 'medication', label: 'Ilac', color: '#1E88E5' },
  { value: 'allergy', label: 'Alerji', color: '#D81B60' },
  { value: 'other', label: 'Diger', color: COLORS.textSecondary },
];

const TYPE_MAP = Object.fromEntries(EVENT_TYPES.map(t => [t.value, t]));

// Using service's HealthEvent type: { id, event_type, description, event_date, is_ongoing }

export default function HealthEventsScreen() {
  const user = useAuthStore(s => s.user);
  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form
  const [eventType, setEventType] = useState<EventType>('surgery');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [isOngoing, setIsOngoing] = useState(false);
  const [bodyPart, setBodyPart] = useState('');
  const [affectsExercise, setAffectsExercise] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    const data = await getHealthEvents();
    setEvents(data as HealthEvent[]);
  };

  const resetForm = () => {
    setEventType('surgery'); setTitle(''); setDescription('');
    setEventDate(''); setIsOngoing(false); setBodyPart('');
    setAffectsExercise(false); setEditingId(null); setShowForm(false);
  };

  const startEdit = (ev: HealthEvent) => {
    setEditingId(ev.id);
    setEventType(ev.event_type as EventType);
    setEventDate(ev.event_date ?? '');
    setIsOngoing(ev.is_ongoing);
    // Parse structured description: "Title | Bolge: X | Egzersizi etkiler | Details"
    const parts = ev.description.split(' | ');
    setTitle(parts[0] ?? '');
    const bodyMatch = ev.description.match(/Bolge: ([^|]+)/);
    setBodyPart(bodyMatch ? bodyMatch[1].trim() : '');
    setAffectsExercise(ev.description.includes('Egzersizi etkiler'));
    const detailParts = parts.filter(p => !p.startsWith('Bolge:') && p !== 'Egzersizi etkiler' && p !== parts[0]);
    setDescription(detailParts.join(' | ').trim());
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!title.trim()) { Alert.alert('Hata', 'Baslik gir.'); return; }
    if (eventDate && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(eventDate)) {
      Alert.alert('Hata', 'Tarih: YYYY, YYYY-MM veya YYYY-MM-DD');
      return;
    }

    const notesParts: string[] = [];
    if (bodyPart.trim()) notesParts.push(`Bolge: ${bodyPart.trim()}`);
    if (affectsExercise) notesParts.push('Egzersizi etkiler');
    if (description.trim()) notesParts.push(description.trim());
    const notes = notesParts.join(' | ') || null;

    // Build structured description: "Title | Bolge: X | Egzersizi etkiler | Details"
    const descParts: string[] = [title.trim()];
    if (bodyPart.trim()) descParts.push(`Bolge: ${bodyPart.trim()}`);
    if (affectsExercise) descParts.push('Egzersizi etkiler');
    if (description.trim()) descParts.push(description.trim());
    const fullDescription = descParts.join(' | ');

    if (editingId) {
      await supabase.from('health_events').update({
        event_type: eventType, description: fullDescription,
        event_date: eventDate || null, is_ongoing: isOngoing,
      }).eq('id', editingId);
    } else {
      await addHealthEvent({
        user_id: user?.id ?? '', event_type: eventType,
        description: fullDescription, event_date: eventDate || null,
        is_ongoing: isOngoing,
      } as never);
    }

    resetForm();
    load();
  };

  const handleDelete = (id: string, name: string) => {
    Alert.alert('Sil', `"${name}" silinsin mi?`, [
      { text: 'Iptal' },
      { text: 'Sil', style: 'destructive', onPress: async () => {
        await supabase.from('health_events').delete().eq('id', id);
        load();
      }},
    ]);
  };

  const grouped = EVENT_TYPES.map(t => ({
    ...t, items: events.filter(e => e.event_type === t.value),
  })).filter(g => g.items.length > 0);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Saglik Gecmisi</Text>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.lg, lineHeight: 20 }}>
        AI kocun bunlari antrenman ve beslenme onerilerinde dikkate alir.
      </Text>

      <Button title={showForm ? 'Iptal' : (editingId ? 'Duzenle' : 'Yeni Kayit')} variant={showForm ? 'ghost' : 'primary'} onPress={() => showForm ? resetForm() : setShowForm(true)} />

      {showForm && (
        <Card style={{ marginTop: SPACING.md }}>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '500', marginBottom: SPACING.sm }}>Tur</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.md }}>
            {EVENT_TYPES.map(t => (
              <TouchableOpacity key={t.value} onPress={() => setEventType(t.value)}
                style={{ paddingVertical: 6, paddingHorizontal: SPACING.md, borderRadius: 8, borderWidth: 1,
                  borderColor: eventType === t.value ? t.color : COLORS.border,
                  backgroundColor: eventType === t.value ? t.color : 'transparent' }}>
                <Text style={{ color: eventType === t.value ? '#fff' : COLORS.textSecondary, fontSize: FONT.sm }}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Input label="Baslik *" placeholder="Diz ameliyati, Omuz sakatiligi..." value={title} onChangeText={setTitle} />
          <Input label="Tarih (opsiyonel)" placeholder="2022 veya 2022-06-15" value={eventDate} onChangeText={setEventDate} />

          {(eventType === 'surgery' || eventType === 'injury') && (
            <Input label="Etkilenen bolge" placeholder="sag diz, sol omuz, bel..." value={bodyPart} onChangeText={setBodyPart} />
          )}

          <Input label="Aciklama (opsiyonel)" placeholder="Detaylar, iyilesme, doktor notu..." value={description} onChangeText={setDescription} multiline numberOfLines={2} style={{ minHeight: 50, textAlignVertical: 'top' }} />

          <View style={{ gap: SPACING.sm, marginBottom: SPACING.md }}>
            <Checkbox label="Devam ediyor (kronik / aktif)" checked={isOngoing} onToggle={() => setIsOngoing(!isOngoing)} color={COLORS.primary} />
            <Checkbox label="Egzersiz kisitlamasi var" checked={affectsExercise} onToggle={() => setAffectsExercise(!affectsExercise)} color={COLORS.warning} />
          </View>

          <Button title={editingId ? 'Guncelle' : 'Kaydet'} onPress={handleSave} />
        </Card>
      )}

      {grouped.length === 0 && !showForm ? (
        <Card style={{ marginTop: SPACING.md }}>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.xl }}>
            Henuz kayit yok. Kocuna da "2022'de diz ameliyati oldum" yazabilirsin.
          </Text>
        </Card>
      ) : (
        grouped.map(group => (
          <View key={group.value} style={{ marginTop: SPACING.md }}>
            <Text style={{ color: group.color, fontSize: FONT.sm, fontWeight: '700', marginBottom: SPACING.xs }}>
              {group.label} ({group.items.length})
            </Text>
            {group.items.map(ev => (
              <TouchableOpacity key={ev.id} onPress={() => startEdit(ev)} onLongPress={() => handleDelete(ev.id, ev.description)}
                style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, marginBottom: SPACING.xs, borderLeftWidth: 3, borderLeftColor: group.color }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600', flex: 1 }}>{ev.description}</Text>
                  <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                    {ev.is_ongoing && <SmallBadge text="aktif" color={COLORS.warning} />}
                    {ev.description?.includes('Egzersizi etkiler') && <SmallBadge text="kisitlama" color={COLORS.error} />}
                    {ev.event_date && <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{ev.event_date}</Text>}
                  </View>
                </View>
                {ev.description && <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginTop: 4, lineHeight: 18 }}>{ev.description}</Text>}
              </TouchableOpacity>
            ))}
          </View>
        ))
      )}

      <Text style={{ color: COLORS.textMuted, fontSize: 10, textAlign: 'center', marginTop: SPACING.md }}>
        Dokun: duzenle · Uzun bas: sil
      </Text>
    </ScrollView>
  );
}

function Checkbox({ label, checked, onToggle, color }: { label: string; checked: boolean; onToggle: () => void; color: string }) {
  return (
    <TouchableOpacity onPress={onToggle} style={{ flexDirection: 'row', gap: SPACING.sm, alignItems: 'center' }}>
      <View style={{ width: 22, height: 22, borderRadius: 4, borderWidth: 1.5, borderColor: checked ? color : COLORS.border, backgroundColor: checked ? color : 'transparent', justifyContent: 'center', alignItems: 'center' }}>
        {checked && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✓</Text>}
      </View>
      <Text style={{ color: COLORS.text, fontSize: FONT.sm }}>{label}</Text>
    </TouchableOpacity>
  );
}

function SmallBadge({ text, color }: { text: string; color: string }) {
  return (
    <View style={{ backgroundColor: color, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
      <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}
