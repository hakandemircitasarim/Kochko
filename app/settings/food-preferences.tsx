import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  FlatList,
  TouchableOpacity,
} from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { COLORS, SPACING, FONT_SIZE } from '@/lib/constants';
import type { FoodPreference } from '@/types/database';

interface FoodPrefEntry {
  id: string;
  food_name: string;
  preference: FoodPreference;
  intolerance: boolean;
}

const prefLabels: Record<FoodPreference, string> = {
  love: 'Bayılırım',
  like: 'Severim',
  dislike: 'Sevmem',
  never: 'Asla',
};

const prefColors: Record<FoodPreference, string> = {
  love: COLORS.success,
  like: '#8BC34A',
  dislike: COLORS.warning,
  never: COLORS.error,
};

export default function FoodPreferencesScreen() {
  const user = useAuthStore((s) => s.user);
  const [items, setItems] = useState<FoodPrefEntry[]>([]);
  const [newFood, setNewFood] = useState('');
  const [newPref, setNewPref] = useState<FoodPreference>('never');
  const [newIntolerance, setNewIntolerance] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPreferences();
  }, [user?.id]);

  async function loadPreferences() {
    if (!user?.id) return;
    const { data } = await supabase
      .from('food_preferences')
      .select('*')
      .eq('user_id', user.id)
      .order('food_name');
    setItems((data as FoodPrefEntry[]) ?? []);
    setLoading(false);
  }

  const handleAdd = async () => {
    if (!user?.id || !newFood.trim()) {
      Alert.alert('Hata', 'Yiyecek adı girin.');
      return;
    }

    const { error } = await supabase.from('food_preferences').upsert({
      user_id: user.id,
      food_name: newFood.trim().toLowerCase(),
      preference: newPref,
      intolerance: newIntolerance,
    }, { onConflict: 'user_id,food_name' });

    if (error) {
      Alert.alert('Hata', error.message);
    } else {
      setNewFood('');
      setNewIntolerance(false);
      loadPreferences();
    }
  };

  const handleDelete = async (id: string) => {
    await supabase.from('food_preferences').delete().eq('id', id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const prefOptions: FoodPreference[] = ['love', 'like', 'dislike', 'never'];

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Yemek Tercihleri</Text>
        <Text style={styles.subtitle}>
          Sevdiğin ve sevmediğin yemekleri ekle. AI planlarında bunları dikkate alır.
        </Text>

        {/* Add new */}
        <View style={styles.addSection}>
          <Input
            label="Yiyecek adı"
            placeholder="Örn: brokoli, süt, balık..."
            value={newFood}
            onChangeText={setNewFood}
          />
          <View style={styles.prefRow}>
            {prefOptions.map((p) => (
              <TouchableOpacity
                key={p}
                style={[
                  styles.prefChip,
                  newPref === p && { backgroundColor: prefColors[p], borderColor: prefColors[p] },
                ]}
                onPress={() => setNewPref(p)}
              >
                <Text
                  style={[
                    styles.prefChipText,
                    newPref === p && { color: '#fff' },
                  ]}
                >
                  {prefLabels[p]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={styles.intoleranceToggle}
            onPress={() => setNewIntolerance(!newIntolerance)}
          >
            <Text style={styles.intoleranceIcon}>{newIntolerance ? '[x]' : '[ ]'}</Text>
            <Text style={styles.intoleranceText}>İntolerans / Alerji</Text>
          </TouchableOpacity>
          <Button title="Ekle" onPress={handleAdd} size="md" />
        </View>

        {/* List */}
        {items.length === 0 && !loading ? (
          <Text style={styles.emptyText}>Henüz tercih eklenmemiş.</Text>
        ) : (
          <View style={styles.list}>
            {(['never', 'dislike', 'love', 'like'] as FoodPreference[]).map((pref) => {
              const group = items.filter((i) => i.preference === pref);
              if (group.length === 0) return null;
              return (
                <View key={pref} style={styles.group}>
                  <Text style={[styles.groupTitle, { color: prefColors[pref] }]}>
                    {prefLabels[pref]} ({group.length})
                  </Text>
                  {group.map((item) => (
                    <View key={item.id} style={styles.listItem}>
                      <Text style={styles.foodName}>{item.food_name}</Text>
                      {item.intolerance && (
                        <Text style={styles.intoleranceBadge}>intolerans</Text>
                      )}
                      <TouchableOpacity onPress={() => handleDelete(item.id)}>
                        <Text style={styles.deleteBtn}>Sil</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  title: { fontSize: FONT_SIZE.xxl, fontWeight: '800', color: COLORS.text },
  subtitle: { fontSize: FONT_SIZE.md, color: COLORS.textSecondary, marginTop: SPACING.xs, marginBottom: SPACING.lg, lineHeight: 22 },
  addSection: { backgroundColor: COLORS.card, borderRadius: 16, padding: SPACING.md, marginBottom: SPACING.lg, borderWidth: 1, borderColor: COLORS.border },
  prefRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md },
  prefChip: { paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border },
  prefChipText: { color: COLORS.textSecondary, fontSize: FONT_SIZE.sm, fontWeight: '500' },
  intoleranceToggle: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md },
  intoleranceIcon: { color: COLORS.primary, fontSize: FONT_SIZE.md, fontWeight: '600' },
  intoleranceText: { color: COLORS.textSecondary, fontSize: FONT_SIZE.sm },
  emptyText: { color: COLORS.textMuted, fontSize: FONT_SIZE.sm, textAlign: 'center', marginTop: SPACING.xl },
  list: { gap: SPACING.lg },
  group: { gap: SPACING.xs },
  groupTitle: { fontSize: FONT_SIZE.md, fontWeight: '700', marginBottom: SPACING.xs },
  listItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, backgroundColor: COLORS.card, borderRadius: 8, gap: SPACING.sm },
  foodName: { color: COLORS.text, fontSize: FONT_SIZE.md, flex: 1, textTransform: 'capitalize' },
  intoleranceBadge: { color: COLORS.warning, fontSize: FONT_SIZE.xs, fontWeight: '500' },
  deleteBtn: { color: COLORS.error, fontSize: FONT_SIZE.sm },
});
