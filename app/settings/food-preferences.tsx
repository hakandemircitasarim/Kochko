import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';

type Pref = 'love' | 'like' | 'can_cook' | 'dislike' | 'never';
const PREF_LABELS: Record<Pref, string> = { love: 'Bayılırım', like: 'Severim', can_cook: 'Yapabilirim', dislike: 'Sevmem', never: 'Asla' };
const PREF_COLORS: Record<Pref, string> = { love: COLORS.success, like: COLORS.protein, can_cook: COLORS.primary, dislike: COLORS.warning, never: COLORS.error };

interface FoodPref { id: string; food_name: string; preference: Pref; is_allergen: boolean; }

export default function FoodPreferencesScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const [items, setItems] = useState<FoodPref[]>([]);
  const [loading, setLoading] = useState(true);
  const [newFood, setNewFood] = useState('');
  const [newPref, setNewPref] = useState<Pref>('never');
  const [isAllergen, setIsAllergen] = useState(false);

  useEffect(() => { load(); }, [user?.id]);

  async function load() {
    if (!user?.id) return;
    const { data } = await supabase.from('food_preferences').select('*').eq('user_id', user.id).order('food_name');
    setItems((data ?? []) as FoodPref[]);
    setLoading(false);
  }

  const handleAdd = async () => {
    if (!user?.id || !newFood.trim()) return;
    const { error } = await supabase.from('food_preferences').upsert({
      user_id: user.id, food_name: newFood.trim().toLowerCase(), preference: newPref, is_allergen: isAllergen,
    }, { onConflict: 'user_id,food_name' });
    if (error) { haptics.error(); Alert.alert('Kaydedilemedi', error.message ?? 'Bir hata oluştu, tekrar dene.'); return; }
    haptics.success();
    setNewFood(''); setIsAllergen(false); load();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('food_preferences').delete().eq('id', id);
    if (error) { haptics.error(); Alert.alert('Silinemedi', error.message ?? 'Bir hata oluştu, tekrar dene.'); return; }
    haptics.success();
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const confirmDelete = (id: string, foodName: string) => {
    Alert.alert('Sil', `"${foodName}" tercihini silmek istediğine emin misin?`, [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => handleDelete(id) },
    ]);
  };

  if (loading) {
    return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Yemek Tercihleri</Text>
        <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg }}>Sevdiğin ve sevmediğin yemekleri ekle. AI bunları dikkate alır.</Text>

        <Card>
          <Input label="Yiyecek adı" placeholder="brokoli, süt, balık..." value={newFood} onChangeText={setNewFood} returnKeyType="done" onSubmitEditing={handleAdd} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.md }}>
            {(Object.keys(PREF_LABELS) as Pref[]).map(p => {
              const active = newPref === p;
              return (
                <TouchableOpacity key={p} onPress={() => { haptics.tap(); setNewPref(p); }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Tercih: ${PREF_LABELS[p]}`}
                  style={{ paddingVertical: 6, paddingHorizontal: SPACING.sm, borderRadius: 8, borderWidth: 1,
                    borderColor: active ? PREF_COLORS[p] : COLORS.border,
                    backgroundColor: active ? PREF_COLORS[p] : 'transparent' }}>
                  <Text style={{ color: active ? getContrastColor(PREF_COLORS[p]) : COLORS.textSecondary, fontSize: FONT.xs }}>{PREF_LABELS[p]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity onPress={() => { haptics.tap(); setIsAllergen(!isAllergen); }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isAllergen }}
            accessibilityLabel="Alerjen / İntolerans"
            style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: 44, marginBottom: SPACING.md }}>
            <Ionicons name={isAllergen ? 'checkbox' : 'square-outline'} size={24} color={isAllergen ? COLORS.primary : COLORS.textMuted} />
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Alerjen / İntolerans</Text>
          </TouchableOpacity>
          <Button title="Ekle" onPress={handleAdd} size="md" />
        </Card>

        {(['never', 'dislike', 'love', 'like', 'can_cook'] as Pref[]).map(pref => {
          const group = items.filter(i => i.preference === pref);
          if (group.length === 0) return null;
          return (
            <View key={pref} style={{ marginBottom: SPACING.md }}>
              <Text style={{ color: PREF_COLORS[pref], fontSize: FONT.sm, fontWeight: '700', marginBottom: SPACING.xs }}>{PREF_LABELS[pref]} ({group.length})</Text>
              {group.map(item => (
                <TouchableOpacity key={item.id} onLongPress={() => confirmDelete(item.id, item.food_name)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.card, borderRadius: 8, paddingVertical: SPACING.sm, paddingLeft: SPACING.sm, paddingRight: SPACING.xs, marginBottom: 4 }}>
                  <Text style={{ color: COLORS.text, fontSize: FONT.md, flex: 1, textTransform: 'capitalize' }}>{item.food_name}</Text>
                  {item.is_allergen && <Text style={{ color: COLORS.warning, fontSize: FONT.xs }}>alerjen</Text>}
                  <TouchableOpacity onPress={() => confirmDelete(item.id, item.food_name)}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.food_name} tercihini sil`}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="trash-outline" size={18} color={COLORS.textMuted} />
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </View>
          );
        })}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
