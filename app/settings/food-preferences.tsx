import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

type Pref = 'love' | 'like' | 'can_cook' | 'dislike' | 'never';
const PREF_LABELS: Record<Pref, string> = { love: 'Bayılırım', like: 'Severim', can_cook: 'Yapabilirim', dislike: 'Sevmem', never: 'Asla' };
const PREF_COLORS: Record<Pref, string> = { love: COLORS.success, like: '#8BC34A', can_cook: COLORS.primary, dislike: COLORS.warning, never: COLORS.error };

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
    await supabase.from('food_preferences').upsert({
      user_id: user.id, food_name: newFood.trim().toLowerCase(), preference: newPref, is_allergen: isAllergen,
    }, { onConflict: 'user_id,food_name' });
    setNewFood(''); setIsAllergen(false); load();
  };

  const handleDelete = async (id: string) => {
    await supabase.from('food_preferences').delete().eq('id', id);
    setItems(prev => prev.filter(i => i.id !== id));
  };

  if (loading) {
    return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Yemek Tercihleri</Text>
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg }}>Sevdiğin ve sevmediğin yemekleri ekle. AI bunları dikkate alır.</Text>

      <Card>
        <Input label="Yiyecek adı" placeholder="brokoli, süt, balık..." value={newFood} onChangeText={setNewFood} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.md }}>
          {(Object.keys(PREF_LABELS) as Pref[]).map(p => (
            <TouchableOpacity key={p} onPress={() => setNewPref(p)}
              style={{ paddingVertical: 6, paddingHorizontal: SPACING.sm, borderRadius: 8, borderWidth: 1,
                borderColor: newPref === p ? PREF_COLORS[p] : COLORS.border,
                backgroundColor: newPref === p ? PREF_COLORS[p] : 'transparent' }}>
              <Text style={{ color: newPref === p ? '#fff' : COLORS.textSecondary, fontSize: FONT.xs }}>{PREF_LABELS[p]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity onPress={() => setIsAllergen(!isAllergen)} style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
          <Text style={{ color: COLORS.primary, fontSize: FONT.md }}>{isAllergen ? '[x]' : '[ ]'}</Text>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Alerjen / İntolerans</Text>
        </TouchableOpacity>
        <Button title="Ekle" onPress={handleAdd} size="sm" />
      </Card>

      {(['never', 'dislike', 'love', 'like', 'can_cook'] as Pref[]).map(pref => {
        const group = items.filter(i => i.preference === pref);
        if (group.length === 0) return null;
        return (
          <View key={pref} style={{ marginBottom: SPACING.md }}>
            <Text style={{ color: PREF_COLORS[pref], fontSize: FONT.sm, fontWeight: '700', marginBottom: SPACING.xs }}>{PREF_LABELS[pref]} ({group.length})</Text>
            {group.map(item => (
              <TouchableOpacity key={item.id} onLongPress={() => handleDelete(item.id)}
                style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.card, borderRadius: 8, padding: SPACING.sm, marginBottom: 4 }}>
                <Text style={{ color: COLORS.text, fontSize: FONT.md, flex: 1, textTransform: 'capitalize' }}>{item.food_name}</Text>
                {item.is_allergen && <Text style={{ color: COLORS.warning, fontSize: FONT.xs }}>alerjen</Text>}
              </TouchableOpacity>
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}
