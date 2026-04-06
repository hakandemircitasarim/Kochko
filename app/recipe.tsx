/**
 * Recipe Detail Page — accessed from coach chat or plan
 * Shows ingredients, steps, macros. Save to library, ask AI for substitutions.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, FlatList } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/auth.store';
import { getRecipes, type SavedRecipe } from '@/services/recipes.service';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';

export default function RecipeScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const user = useAuthStore(s => s.user);
  const [recipes, setRecipes] = useState<SavedRecipe[]>([]);
  const [selected, setSelected] = useState<SavedRecipe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRecipes();
  }, []);

  const loadRecipes = async () => {
    setLoading(true);
    const data = await getRecipes();
    setRecipes(data);
    if (id) {
      const found = data.find(r => r.id === id);
      if (found) setSelected(found);
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Recipe detail view
  if (selected) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScrollView contentContainerStyle={{ padding: SPACING.xl, paddingBottom: 100 }}>
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.xxl }}>
            <TouchableOpacity onPress={() => setSelected(null)} style={{ marginRight: SPACING.md }}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={{ fontSize: 18, fontWeight: '600', color: colors.text, flex: 1 }} numberOfLines={1}>{selected.title}</Text>
          </View>

          {/* Macro summary */}
          <View style={{
            backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.lg,
            borderWidth: 0.5, borderColor: colors.border, marginBottom: SPACING.md,
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              {[
                { label: 'Kalori', value: selected.total_calories ?? '-', color: METRIC_COLORS.calories, unit: 'kcal' },
                { label: 'Protein', value: selected.total_protein ?? '-', color: METRIC_COLORS.protein, unit: 'g' },
                { label: 'Sure', value: selected.prep_time_min ?? '-', color: colors.textSecondary, unit: 'dk' },
                { label: 'Porsiyon', value: selected.servings, color: colors.textSecondary, unit: '' },
              ].map((m, i) => (
                <View key={i} style={{ alignItems: 'center', flex: 1 }}>
                  <Text style={{ color: m.color, fontSize: 18, fontWeight: '700' }}>{m.value}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 11 }}>{m.unit} {m.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Ingredients */}
          <SectionCard title="Malzemeler" colors={colors}>
            {selected.ingredients.map((ing, i) => (
              <View key={i} style={{
                flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                paddingVertical: SPACING.sm,
                borderBottomWidth: i < selected.ingredients.length - 1 ? 0.5 : 0,
                borderBottomColor: colors.border,
              }}>
                <Text style={{ color: colors.text, fontSize: 13, flex: 1 }}>{ing.name}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>{ing.amount} {ing.unit}</Text>
              </View>
            ))}
          </SectionCard>

          {/* Instructions */}
          <SectionCard title="Yapilis" colors={colors}>
            <Text style={{ color: colors.text, fontSize: 13, lineHeight: 22 }}>{selected.instructions}</Text>
          </SectionCard>

          {/* Actions */}
          <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md }}>
            <TouchableOpacity
              onPress={() => {
                router.push({ pathname: '/(tabs)/chat', params: { prefill: `${selected.title} tarifindeki malzemeleri degistirebilir misin?` } });
              }}
              style={{
                flex: 1, paddingVertical: SPACING.md, borderRadius: RADIUS.sm,
                borderWidth: 0.5, borderColor: colors.primary, alignItems: 'center',
              }}
            >
              <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '500' }}>Malzeme degistir</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  // Recipe list view
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ padding: SPACING.xl, paddingTop: 60 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.xxl }}>
          <TouchableOpacity onPress={() => router.back()} style={{ marginRight: SPACING.md }}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={{ fontSize: 18, fontWeight: '600', color: colors.text }}>Tarifler</Text>
        </View>
      </View>

      {recipes.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl }}>
          <Ionicons name="restaurant-outline" size={48} color={colors.textMuted} />
          <Text style={{ color: colors.textMuted, fontSize: 14, marginTop: SPACING.md, textAlign: 'center' }}>
            Henuz kayitli tarif yok
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: SPACING.sm, textAlign: 'center' }}>
            Kocuna tarif sor, begendiklerini kaydet
          </Text>
        </View>
      ) : (
        <FlatList
          data={recipes}
          keyExtractor={r => r.id}
          contentContainerStyle={{ paddingHorizontal: SPACING.xl, paddingBottom: 100 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => setSelected(item)}
              style={{
                backgroundColor: colors.card, borderRadius: RADIUS.md,
                padding: SPACING.lg, marginBottom: SPACING.sm,
                borderWidth: 0.5, borderColor: colors.border,
                flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
              }}
            >
              <View style={{
                width: 40, height: 40, borderRadius: RADIUS.sm,
                backgroundColor: METRIC_COLORS.calories + '18',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Ionicons name="restaurant" size={20} color={METRIC_COLORS.calories} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '500' }}>{item.title}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>
                  {item.total_calories ?? '?'} kcal
                  {item.prep_time_min ? ` \u00b7 ${item.prep_time_min} dk` : ''}
                  {item.category ? ` \u00b7 ${item.category}` : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

function SectionCard({ title, colors, children }: { title: string; colors: any; children: React.ReactNode }) {
  return (
    <View style={{
      backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.lg,
      marginBottom: SPACING.md, borderWidth: 0.5, borderColor: colors.border,
    }}>
      <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SPACING.md }}>
        {title}
      </Text>
      {children}
    </View>
  );
}
