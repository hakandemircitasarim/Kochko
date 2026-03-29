import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { getRecipes, deleteRecipe, type SavedRecipe } from '@/services/recipes.service';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const CAT_LABELS: Record<string, string> = {
  breakfast: 'Kahvalti', lunch: 'Ogle', dinner: 'Aksam', snack: 'Atistirmalik', dessert: 'Tatli',
};

export default function RecipesScreen() {
  const [recipes, setRecipes] = useState<SavedRecipe[]>([]);
  const [filter, setFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => { load(); }, [filter]);
  const load = () => getRecipes(filter ?? undefined).then(setRecipes);

  const handleDelete = (id: string) => {
    Alert.alert('Sil', 'Tarifi silmek istediginize emin misiniz?', [
      { text: 'Iptal' },
      { text: 'Sil', style: 'destructive', onPress: () => { deleteRecipe(id); setRecipes(prev => prev.filter(r => r.id !== id)); } },
    ]);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Tarif Kutuphanesi</Text>
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg }}>Kocundan aldığın tarifleri burada bulabilirsin.</Text>

      {/* Filter */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.md }}>
        <TouchableOpacity onPress={() => setFilter(null)}
          style={{ paddingVertical: 4, paddingHorizontal: SPACING.sm, borderRadius: 8, backgroundColor: !filter ? COLORS.primary : 'transparent', borderWidth: 1, borderColor: !filter ? COLORS.primary : COLORS.border }}>
          <Text style={{ color: !filter ? '#fff' : COLORS.textSecondary, fontSize: FONT.xs }}>Tumu</Text>
        </TouchableOpacity>
        {Object.entries(CAT_LABELS).map(([key, label]) => (
          <TouchableOpacity key={key} onPress={() => setFilter(key)}
            style={{ paddingVertical: 4, paddingHorizontal: SPACING.sm, borderRadius: 8, backgroundColor: filter === key ? COLORS.primary : 'transparent', borderWidth: 1, borderColor: filter === key ? COLORS.primary : COLORS.border }}>
            <Text style={{ color: filter === key ? '#fff' : COLORS.textSecondary, fontSize: FONT.xs }}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {recipes.length === 0 ? (
        <Card><Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.xl }}>Henuz kayitli tarif yok. Kocundan tarif iste ve "Kaydet" de.</Text></Card>
      ) : (
        recipes.map(r => (
          <TouchableOpacity key={r.id} onPress={() => setExpanded(expanded === r.id ? null : r.id)} onLongPress={() => handleDelete(r.id)}>
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>{r.name}</Text>
                  <View style={{ flexDirection: 'row', gap: SPACING.md, marginTop: 4 }}>
                    {r.total_calories && <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{r.total_calories} kcal</Text>}
                    {r.total_protein && <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{r.total_protein}g pro</Text>}
                    {r.prep_time_min && <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{r.prep_time_min + (r.cook_time_min ?? 0)} dk</Text>}
                    {r.category && <Text style={{ color: COLORS.primary, fontSize: FONT.xs }}>{CAT_LABELS[r.category] ?? r.category}</Text>}
                  </View>
                </View>
                <Text style={{ color: COLORS.textMuted, fontSize: FONT.md }}>{expanded === r.id ? '-' : '+'}</Text>
              </View>

              {expanded === r.id && (
                <View style={{ marginTop: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: SPACING.md }}>
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginBottom: SPACING.xs }}>MALZEMELER</Text>
                  {r.ingredients.map((ing, i) => (
                    <Text key={i} style={{ color: COLORS.text, fontSize: FONT.sm, paddingVertical: 1 }}>- {ing.amount} {ing.unit} {ing.name}</Text>
                  ))}
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginTop: SPACING.md, marginBottom: SPACING.xs }}>YAPILISI</Text>
                  <Text style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 22 }}>{r.instructions}</Text>
                  <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: SPACING.sm }}>{r.servings} porsiyon</Text>
                </View>
              )}
            </Card>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}
