import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getRecipes, deleteRecipe, updateRecipe, scaleRecipe, suggestSubstitution, toggleFavorite, incrementUseCount, getRecipesByIngredients, type SavedRecipe } from '@/services/recipes.service';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const CAT_LABELS: Record<string, string> = {
  breakfast: 'Kahvalti', lunch: 'Ogle', dinner: 'Aksam', snack: 'Atistirmalik', dessert: 'Tatli',
};

export default function RecipesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [recipes, setRecipes] = useState<SavedRecipe[]>([]);
  const [filter, setFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editInstructions, setEditInstructions] = useState('');
  const [editServings, setEditServings] = useState('');
  // D9: Portion scaling state
  const [scaledRecipes, setScaledRecipes] = useState<Record<string, SavedRecipe>>({});
  const [scalingServings, setScalingServings] = useState<Record<string, number>>({});
  // D10: Substitution state
  const [substitutions, setSubstitutions] = useState<Record<string, { replacement: string; note_tr: string }[]>>({});
  // P1#10: "Elimde sunlar var" ingredient match
  const [ingredientQuery, setIngredientQuery] = useState('');
  const [ingredientMatches, setIngredientMatches] = useState<{ recipe: SavedRecipe; matchPercent: number }[] | null>(null);

  useEffect(() => { load(); }, [filter]);
  const load = () => getRecipes(filter ?? undefined).then(setRecipes);

  const handleDelete = (id: string) => {
    Alert.alert('Sil', 'Tarifi silmek istediğine emin misin?', [
      { text: 'İptal' },
      { text: 'Sil', style: 'destructive', onPress: async () => {
        try {
          await deleteRecipe(id);
        } catch {
          Alert.alert('Hata', 'Tarif silinemedi, tekrar dene.');
          return;
        }
        setRecipes(prev => prev.filter(r => r.id !== id));
      } },
    ]);
  };

  const startEdit = (recipe: SavedRecipe) => {
    setEditingId(recipe.id);
    setEditTitle(recipe.title);
    setEditInstructions(recipe.instructions);
    setEditServings(String(recipe.servings));
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const servingsNum = parseInt(editServings, 10);
    try {
      await updateRecipe(editingId, {
        title: editTitle.trim(),
        instructions: editInstructions.trim(),
        servings: isNaN(servingsNum) ? 1 : servingsNum,
      });
    } catch {
      Alert.alert('Hata', 'Tarif kaydedilemedi, tekrar dene.');
      return;
    }
    setEditingId(null);
    load();
  };

  const navigateToChat = () => {
    router.push('/(tabs)/chat');
  };

  // D9: Handle portion scaling
  const handleScale = (recipe: SavedRecipe, targetServings: number) => {
    const scaled = scaleRecipe(recipe, targetServings);
    setScaledRecipes(prev => ({ ...prev, [recipe.id]: scaled }));
    setScalingServings(prev => ({ ...prev, [recipe.id]: targetServings }));
  };

  // D10: Handle ingredient substitution
  const handleSubstitution = (recipeId: string, ingredientName: string) => {
    const subs = suggestSubstitution(ingredientName);
    if (subs.length === 0) {
      Alert.alert('Ikame Bulunamadi', `"${ingredientName}" icin bilinen bir ikame yok.`);
      return;
    }
    setSubstitutions(prev => ({ ...prev, [`${recipeId}:${ingredientName}`]: subs }));
  };

  // P1#2: Favorite toggle + "cooked it" use-count (feeds ai-plan's saved-recipe preference query)
  const handleToggleFavorite = async (r: SavedRecipe) => {
    const next = !(r.is_favorite ?? false);
    setRecipes(prev => prev.map(x => x.id === r.id ? { ...x, is_favorite: next } : x));
    await toggleFavorite(r.id, r.is_favorite ?? false);
  };

  const handleCooked = async (r: SavedRecipe) => {
    setRecipes(prev => prev.map(x => x.id === r.id ? { ...x, use_count: (x.use_count ?? 0) + 1 } : x));
    await incrementUseCount(r.id);
    Alert.alert('Isaretlendi', `"${r.title}" kullanildi olarak kaydedildi. Koc haftalik plan yaparken sik kullandigin tarifleri tercih eder.`);
  };

  // P1#10: "Elimde sunlar var" — match saved recipes to available ingredients
  const handleIngredientSearch = async () => {
    const items = ingredientQuery.split(',').map(s => s.trim()).filter(Boolean);
    if (items.length === 0) { setIngredientMatches(null); load(); return; }
    const matches = await getRecipesByIngredients(items);
    setIngredientMatches(matches);
    setRecipes(matches.map(m => m.recipe));
  };

  // Get display recipe (scaled or original)
  const getDisplayRecipe = (r: SavedRecipe): SavedRecipe => scaledRecipes[r.id] ?? r;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
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

      {/* P1#10: "Elimde sunlar var" ingredient match */}
      <View style={{ flexDirection: 'row', gap: SPACING.xs, marginBottom: SPACING.md }}>
        <TextInput
          style={[inputStyle, { flex: 1 }]}
          value={ingredientQuery}
          onChangeText={setIngredientQuery}
          placeholder="Elimde: tavuk, pirinc, brokoli"
          placeholderTextColor={COLORS.textMuted}
        />
        <TouchableOpacity onPress={handleIngredientSearch} style={{ paddingHorizontal: SPACING.md, justifyContent: 'center', borderRadius: 8, backgroundColor: COLORS.primary }}>
          <Text style={{ color: '#fff', fontSize: FONT.sm, fontWeight: '600' }}>Ara</Text>
        </TouchableOpacity>
      </View>
      {ingredientMatches !== null && (
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, marginBottom: SPACING.sm }}>
          {ingredientMatches.length > 0 ? `${ingredientMatches.length} tarif eslesti (en az %50 malzeme).` : 'Eslesen tarif yok. Kocundan bu malzemelerle tarif iste.'}
        </Text>
      )}

      {recipes.length === 0 ? (
        <Card><Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.xl }}>Henuz kayitli tarif yok. Kocundan tarif iste ve "Kaydet" de.</Text></Card>
      ) : (
        recipes.map(r => (
          <TouchableOpacity key={r.id} onPress={() => { if (editingId !== r.id) setExpanded(expanded === r.id ? null : r.id); }} onLongPress={() => handleDelete(r.id)}>
            <Card>
              {editingId === r.id ? (
                /* Edit Mode */
                <View style={{ gap: SPACING.sm }}>
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600' }}>TARIF DUZENLE</Text>
                  <TextInput
                    style={inputStyle}
                    value={editTitle}
                    onChangeText={setEditTitle}
                    placeholder="Tarif adi"
                    placeholderTextColor={COLORS.textMuted}
                  />
                  <TextInput
                    style={[inputStyle, { height: 100, textAlignVertical: 'top' }]}
                    value={editInstructions}
                    onChangeText={setEditInstructions}
                    placeholder="Yapilisi"
                    placeholderTextColor={COLORS.textMuted}
                    multiline
                  />
                  <TextInput
                    style={inputStyle}
                    value={editServings}
                    onChangeText={setEditServings}
                    placeholder="Porsiyon sayisi"
                    placeholderTextColor={COLORS.textMuted}
                    keyboardType="numeric"
                  />
                  <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                    <TouchableOpacity onPress={saveEdit} style={{ flex: 1, paddingVertical: SPACING.sm, borderRadius: 8, backgroundColor: COLORS.success, alignItems: 'center' }}>
                      <Text style={{ color: '#fff', fontSize: FONT.sm, fontWeight: '600' }}>Kaydet</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={cancelEdit} style={{ flex: 1, paddingVertical: SPACING.sm, borderRadius: 8, backgroundColor: COLORS.surfaceLight, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border }}>
                      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '600' }}>Iptal</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                /* View Mode */
                <>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>{r.title}</Text>
                      <View style={{ flexDirection: 'row', gap: SPACING.md, marginTop: 4 }}>
                        {r.total_calories && <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{r.total_calories} kcal</Text>}
                        {r.total_protein && <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{r.total_protein}g pro</Text>}
                        {r.prep_time_min && <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{r.prep_time_min + (r.cook_time_min ?? 0)} dk</Text>}
                        {r.category && <Text style={{ color: COLORS.primary, fontSize: FONT.xs }}>{CAT_LABELS[r.category] ?? r.category}</Text>}
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => handleToggleFavorite(r)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ paddingHorizontal: SPACING.xs }}>
                      <Text style={{ fontSize: 18, color: r.is_favorite ? '#EF9F27' : COLORS.textMuted }}>{r.is_favorite ? '★' : '☆'}</Text>
                    </TouchableOpacity>
                    <Text style={{ color: COLORS.textMuted, fontSize: FONT.md }}>{expanded === r.id ? '-' : '+'}</Text>
                  </View>

                  {expanded === r.id && (() => {
                    const display = getDisplayRecipe(r);
                    const currentScaling = scalingServings[r.id] ?? r.servings;
                    return (
                    <View style={{ marginTop: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: SPACING.md }}>
                      {/* D9: Portion Scaler */}
                      <View style={{ marginBottom: SPACING.md }}>
                        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginBottom: SPACING.xs }}>PORSIYON</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
                          {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                            <TouchableOpacity key={n} onPress={() => handleScale(r, n)}
                              style={{
                                width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center',
                                backgroundColor: currentScaling === n ? COLORS.primary : COLORS.surfaceLight,
                                borderWidth: 1, borderColor: currentScaling === n ? COLORS.primary : COLORS.border,
                              }}>
                              <Text style={{ color: currentScaling === n ? '#fff' : COLORS.text, fontSize: FONT.sm, fontWeight: '600' }}>{n}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        {currentScaling !== r.servings && (
                          <Text style={{ color: COLORS.primary, fontSize: FONT.xs, marginTop: 4 }}>
                            {r.servings} porsiyon &rarr; {currentScaling} porsiyon ({display.total_calories ?? '?'} kcal)
                          </Text>
                        )}
                      </View>

                      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginBottom: SPACING.xs }}>MALZEMELER</Text>
                      {display.ingredients.map((ing, i) => {
                        const subKey = `${r.id}:${ing.name}`;
                        const subs = substitutions[subKey];
                        return (
                          <View key={i}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 2 }}>
                              <Text style={{ color: COLORS.text, fontSize: FONT.sm, flex: 1 }}>- {ing.amount} {ing.unit} {ing.name}</Text>
                              {/* D10: Substitution button */}
                              <TouchableOpacity onPress={() => handleSubstitution(r.id, ing.name)}
                                style={{ paddingVertical: 2, paddingHorizontal: 8, borderRadius: 6, backgroundColor: COLORS.surfaceLight, borderWidth: 1, borderColor: COLORS.border }}>
                                <Text style={{ color: COLORS.primary, fontSize: 10, fontWeight: '600' }}>Ikame</Text>
                              </TouchableOpacity>
                            </View>
                            {/* D10: Show substitutions */}
                            {subs && subs.length > 0 && (
                              <View style={{ marginLeft: SPACING.md, marginBottom: SPACING.xs }}>
                                {subs.map((sub, si) => (
                                  <View key={si} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 2 }}>
                                    <Text style={{ color: COLORS.success, fontSize: FONT.xs }}>  &rarr; {sub.replacement}</Text>
                                    <Text style={{ color: COLORS.textMuted, fontSize: 10, marginLeft: SPACING.xs }}>({sub.note_tr})</Text>
                                  </View>
                                ))}
                              </View>
                            )}
                          </View>
                        );
                      })}

                      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginTop: SPACING.md, marginBottom: SPACING.xs }}>YAPILISI</Text>
                      <Text style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 22 }}>{display.instructions}</Text>
                      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: SPACING.sm }}>{display.servings} porsiyon</Text>
                      <View style={{ flexDirection: 'row', gap: SPACING.lg, marginTop: SPACING.sm }}>
                        <TouchableOpacity onPress={() => startEdit(r)} style={{ paddingVertical: SPACING.xs }}>
                          <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '600' }}>Duzenle</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleCooked(r)} style={{ paddingVertical: SPACING.xs }}>
                          <Text style={{ color: COLORS.success, fontSize: FONT.sm, fontWeight: '600' }}>Pisirdim ✓</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    );
                  })()}
                </>
              )}
            </Card>
          </TouchableOpacity>
        ))
      )}

      {/* AI Suggest Button */}
      <View style={{ marginTop: SPACING.md }}>
        <Button title="AI'dan Tarif Oner" onPress={navigateToChat} variant="outline" />
      </View>
    </ScrollView>
  );
}

const inputStyle = {
  backgroundColor: COLORS.inputBg,
  borderRadius: 8,
  padding: SPACING.sm,
  color: COLORS.text,
  fontSize: FONT.sm,
  borderWidth: 1,
  borderColor: COLORS.border,
};
