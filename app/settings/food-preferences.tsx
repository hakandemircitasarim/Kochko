import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator, KeyboardAvoidingView } from 'react-native';
import { SkeletonScreen } from '@/components/ui/Skeleton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { SPACING, FONT } from '@/lib/constants';
import { useTheme, type ThemeColors } from '@/lib/theme';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';

type Pref = 'love' | 'like' | 'can_cook' | 'dislike' | 'never';
const PREF_LABELS: Record<Pref, string> = { love: 'Bayılırım', like: 'Severim', can_cook: 'Yapabilirim', dislike: 'Sevmem', never: 'Asla' };
// Tema-duyarlı: renk DEĞERİ yerine token ADI tutulur (modül seviyesinde koyu palet donardı),
// render'da aktif temadan çözülür.
const PREF_COLOR_TOKENS: Record<Pref, keyof ThemeColors> = { love: 'success', like: 'protein', can_cook: 'primary', dislike: 'warning', never: 'error' };

interface FoodPref { id: string; food_name: string; preference: Pref; is_allergen: boolean; }

export default function FoodPreferencesScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const [items, setItems] = useState<FoodPref[]>([]);
  const [loading, setLoading] = useState(true);
  // FIX (audit empty-vs-error): fetch hatası eskiden sessizce boş listeye düşüyordu — alerjen
  // listesi güvenlik verisi; hata durumu boş görünümle karışamaz.
  const [loadError, setLoadError] = useState(false);
  const [newFood, setNewFood] = useState('');
  const [newPref, setNewPref] = useState<Pref>('never');
  const [isAllergen, setIsAllergen] = useState(false);

  useEffect(() => { load(); }, [user?.id]);

  async function load() {
    if (!user?.id) return;
    setLoading(true);
    setLoadError(false);
    const { data, error } = await supabase.from('food_preferences').select('*').eq('user_id', user.id).order('food_name');
    if (error) {
      console.warn('food_preferences load failed', error);
      setLoadError(true);
      setLoading(false);
      return;
    }
    setItems((data ?? []) as FoodPref[]);
    setLoading(false);
  }

  const handleAdd = async () => {
    if (!user?.id || !newFood.trim()) return;
    const { error } = await supabase.from('food_preferences').upsert({
      user_id: user.id, food_name: newFood.trim().toLowerCase(), preference: newPref, is_allergen: isAllergen,
    }, { onConflict: 'user_id,food_name' });
    // FIX (audit raw-error): ham (İngilizce) PostgREST hata metni sızdırılmıyor; kullanıcı-dostu Türkçe mesaj.
    if (error) { haptics.error(); Alert.alert('Kaydedilemedi', 'Tercih kaydedilirken bir sorun oluştu. Lütfen tekrar dene.'); return; }
    haptics.success();
    setNewFood(''); setIsAllergen(false); load();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('food_preferences').delete().eq('id', id);
    // FIX (audit raw-error): ham (İngilizce) PostgREST hata metni sızdırılmıyor; kullanıcı-dostu Türkçe mesaj.
    if (error) { haptics.error(); Alert.alert('Silinemedi', 'Tercih silinirken bir sorun oluştu. Lütfen tekrar dene.'); return; }
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
    // FIX (ux-ideas #28): skeleton loader instead of a bare centered spinner (see achievements).
    return <View style={{ flex: 1, backgroundColor: colors.background }}><SkeletonScreen cards={4} /></View>;
  }

  // FIX (audit empty-vs-error): tam-ekran hata+tekrar dene (shared LoadErrorState).
  if (loadError) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadErrorState title="Tercihler yüklenemedi" onRetry={load} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding">
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
        {/* FIX (audit duplicate-title): Native header (settings/_layout.tsx) renders the title; in-body H1 removed as redundant. */}
        <Text style={{ fontSize: FONT.sm, color: colors.textSecondary, marginTop: SPACING.xs, marginBottom: SPACING.lg }}>Sevdiğin ve sevmediğin yemekleri ekle. AI bunları dikkate alır.</Text>

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
                    borderColor: active ? colors[PREF_COLOR_TOKENS[p]] : colors.border,
                    backgroundColor: active ? colors[PREF_COLOR_TOKENS[p]] : 'transparent' }}>
                  <Text style={{ color: active ? getContrastColor(colors[PREF_COLOR_TOKENS[p]]) : colors.textSecondary, fontSize: FONT.xs }}>{PREF_LABELS[p]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity onPress={() => { haptics.tap(); setIsAllergen(!isAllergen); }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isAllergen }}
            accessibilityLabel="Alerjen / İntolerans"
            style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: 44, marginBottom: SPACING.md }}>
            <Ionicons name={isAllergen ? 'checkbox' : 'square-outline'} size={24} color={isAllergen ? colors.primary : colors.textMuted} />
            <Text style={{ color: colors.textSecondary, fontSize: FONT.sm }}>Alerjen / İntolerans</Text>
          </TouchableOpacity>
          <Button title="Ekle" onPress={handleAdd} size="md" />
        </Card>

        {(['never', 'dislike', 'love', 'like', 'can_cook'] as Pref[]).map(pref => {
          const group = items.filter(i => i.preference === pref);
          if (group.length === 0) return null;
          return (
            <View key={pref} style={{ marginBottom: SPACING.md }}>
              <Text style={{ color: colors[PREF_COLOR_TOKENS[pref]], fontSize: FONT.sm, fontWeight: '700', marginBottom: SPACING.xs }}>{PREF_LABELS[pref]} ({group.length})</Text>
              {group.map(item => (
                <TouchableOpacity key={item.id} onLongPress={() => confirmDelete(item.id, item.food_name)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: colors.card, borderRadius: 8, paddingVertical: SPACING.sm, paddingLeft: SPACING.sm, paddingRight: SPACING.xs, marginBottom: 4 }}>
                  <Text style={{ color: colors.text, fontSize: FONT.md, flex: 1, textTransform: 'capitalize' }}>{item.food_name}</Text>
                  {item.is_allergen && <Text style={{ color: colors.warning, fontSize: FONT.xs }}>alerjen</Text>}
                  <TouchableOpacity onPress={() => confirmDelete(item.id, item.food_name)}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.food_name} tercihini sil`}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
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
