/**
 * Venues Screen — Restaurant/venue memory management
 * Spec 2.1: Sık gidilen yemek mekanları
 *
 * Users can add venues manually, edit learned macro estimates,
 * confirm AI estimates, and delete venues.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { getVenues, addOrUpdateVenue, type Venue } from '@/services/venues.service';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const TYPE_LABELS: Record<string, string> = {
  restaurant: 'Restoran', cafeteria: 'Kafeterya', fast_food: 'Fast Food', cafe: 'Kafe',
};
const TYPE_OPTIONS = Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }));

export default function VenuesScreen() {
  const user = useAuthStore(s => s.user);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('restaurant');

  // Edit state
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editItemName, setEditItemName] = useState('');
  const [editItemCal, setEditItemCal] = useState('');
  const [editItemPro, setEditItemPro] = useState('');

  useEffect(() => { load(); }, []);
  const load = () => getVenues().then(setVenues);

  const handleAdd = async () => {
    if (!newName.trim()) { Alert.alert('Hata', 'Mekan adi gir.'); return; }
    await addOrUpdateVenue(newName.trim(), newType, []);
    setNewName('');
    setShowAdd(false);
    load();
  };

  const handleDelete = (id: string, name: string) => {
    Alert.alert('Sil', `"${name}" silinsin mi?`, [
      { text: 'Iptal' },
      { text: 'Sil', style: 'destructive', onPress: async () => {
        await supabase.from('user_venues').delete().eq('id', id);
        setVenues(prev => prev.filter(v => v.id !== id));
      }},
    ]);
  };

  const confirmItem = async (venue: Venue, itemIdx: number) => {
    const items = [...venue.learned_items];
    items[itemIdx] = { ...items[itemIdx], confirmed: true };
    await supabase.from('user_venues').update({ learned_items: items }).eq('id', venue.id);
    load();
  };

  const startEditItem = (venue: Venue, itemIdx: number) => {
    const item = venue.learned_items[itemIdx];
    setEditingItemId(`${venue.id}-${itemIdx}`);
    setEditItemName(item.name);
    setEditItemCal(String(item.calories));
    setEditItemPro(String(item.protein_g ?? ''));
  };

  const saveEditItem = async (venue: Venue, itemIdx: number) => {
    const items = [...venue.learned_items];
    items[itemIdx] = {
      ...items[itemIdx],
      name: editItemName,
      calories: parseInt(editItemCal) || items[itemIdx].calories,
      protein_g: parseInt(editItemPro) || undefined,
      confirmed: true,
    };
    await supabase.from('user_venues').update({ learned_items: items }).eq('id', venue.id);
    setEditingItemId(null);
    load();
  };

  const addItemToVenue = async (venue: Venue) => {
    Alert.prompt?.('Yemek Ekle', 'Yemek adi, kalori, protein (opsiyonel)', (text: string) => {
      // Alert.prompt is iOS only — fallback for Android below
    });
    // Simple approach: add empty item and let user edit
    const items = [...venue.learned_items, { name: 'Yeni yemek', calories: 0, confirmed: false }];
    await supabase.from('user_venues').update({ learned_items: items }).eq('id', venue.id);
    load();
  };

  const deleteItem = async (venue: Venue, itemIdx: number) => {
    const items = venue.learned_items.filter((_, i) => i !== itemIdx);
    await supabase.from('user_venues').update({ learned_items: items }).eq('id', venue.id);
    load();
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Mekanlar</Text>
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg }}>
        Sik gittigin mekanlar ve ogrenilen makro tahminleri. Kocuna "Simit Sarayi'nda yedim" yazdiginda otomatik ogrenilir.
      </Text>

      <Button title={showAdd ? 'Iptal' : 'Mekan Ekle'} variant={showAdd ? 'ghost' : 'primary'} onPress={() => setShowAdd(!showAdd)} />

      {showAdd && (
        <Card style={{ marginTop: SPACING.md }}>
          <Input label="Mekan Adi" placeholder="Simit Sarayi, McDonald's, vb." value={newName} onChangeText={setNewName} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.md }}>
            {TYPE_OPTIONS.map(t => (
              <TouchableOpacity key={t.value} onPress={() => setNewType(t.value)}
                style={{
                  paddingVertical: 6, paddingHorizontal: SPACING.md, borderRadius: 8, borderWidth: 1,
                  borderColor: newType === t.value ? COLORS.primary : COLORS.border,
                  backgroundColor: newType === t.value ? COLORS.primary : 'transparent',
                }}>
                <Text style={{ color: newType === t.value ? '#fff' : COLORS.textSecondary, fontSize: FONT.sm }}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Button title="Kaydet" onPress={handleAdd} />
        </Card>
      )}

      {venues.length === 0 && !showAdd ? (
        <Card style={{ marginTop: SPACING.md }}>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.xl }}>
            Henuz kayitli mekan yok. Kocuna yazarak veya yukardaki butonla ekle.
          </Text>
        </Card>
      ) : (
        venues.map(v => (
          <Card key={v.id} style={{ marginTop: SPACING.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>{v.venue_name}</Text>
                <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>
                  {TYPE_LABELS[v.venue_type ?? ''] ?? ''} · {v.visit_count}x ziyaret
                </Text>
              </View>
              <TouchableOpacity onPress={() => handleDelete(v.id, v.venue_name)}>
                <Text style={{ color: COLORS.error, fontSize: FONT.xs }}>Sil</Text>
              </TouchableOpacity>
            </View>

            {/* Learned items */}
            {v.learned_items.length > 0 && (
              <View style={{ gap: 4 }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginBottom: 2 }}>Ogrenilen Yemekler</Text>
                {v.learned_items.map((item, i) => {
                  const editKey = `${v.id}-${i}`;
                  const isEditing = editingItemId === editKey;

                  if (isEditing) {
                    return (
                      <View key={i} style={{ backgroundColor: COLORS.surfaceLight, borderRadius: 8, padding: SPACING.sm, marginBottom: 4 }}>
                        <Input label="Yemek" value={editItemName} onChangeText={setEditItemName} />
                        <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                          <View style={{ flex: 1 }}><Input label="Kalori" value={editItemCal} onChangeText={setEditItemCal} keyboardType="numeric" /></View>
                          <View style={{ flex: 1 }}><Input label="Protein (g)" value={editItemPro} onChangeText={setEditItemPro} keyboardType="numeric" /></View>
                        </View>
                        <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                          <Button title="Kaydet" size="sm" onPress={() => saveEditItem(v, i)} style={{ flex: 1 }} />
                          <Button title="Iptal" size="sm" variant="ghost" onPress={() => setEditingItemId(null)} style={{ flex: 1 }} />
                        </View>
                      </View>
                    );
                  }

                  return (
                    <TouchableOpacity key={i} onPress={() => startEditItem(v, i)} onLongPress={() => deleteItem(v, i)}
                      style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }}>
                      <Text style={{ color: COLORS.text, fontSize: FONT.sm, flex: 1 }}>{item.name}</Text>
                      <View style={{ flexDirection: 'row', gap: SPACING.sm, alignItems: 'center' }}>
                        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>{item.calories} kcal</Text>
                        {item.protein_g && <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{item.protein_g}g pro</Text>}
                        {item.confirmed
                          ? <Text style={{ color: COLORS.success, fontSize: FONT.xs }}>✓</Text>
                          : <TouchableOpacity onPress={() => confirmItem(v, i)}>
                              <Text style={{ color: COLORS.warning, fontSize: FONT.xs }}>Onayla</Text>
                            </TouchableOpacity>
                        }
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <TouchableOpacity onPress={() => addItemToVenue(v)} style={{ marginTop: SPACING.sm }}>
              <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '600' }}>+ Yemek Ekle</Text>
            </TouchableOpacity>
          </Card>
        ))
      )}

      <Text style={{ color: COLORS.textMuted, fontSize: 10, textAlign: 'center', marginTop: SPACING.md }}>
        Yemege dokun: duzenle · Uzun bas: sil
      </Text>
    </ScrollView>
  );
}
