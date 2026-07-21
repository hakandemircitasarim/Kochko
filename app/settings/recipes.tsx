import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView } from 'react-native';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getRecipes, deleteRecipe, updateRecipe, scaleRecipe, suggestSubstitution, toggleFavorite, incrementUseCount, getRecipesByIngredients, type SavedRecipe } from '@/services/recipes.service';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';
import { MEAL_TYPE_LABELS_TR } from '@/lib/labels';
import { usePremium } from '@/hooks/usePremium';
import { useProfileStore } from '@/stores/profile.store';

// Tarif kategorileri = öğün tipleri + 'dessert' (yalnız tariflere özgü ek kategori).
const CAT_LABELS: Record<string, string> = { ...MEAL_TYPE_LABELS_TR, dessert: 'Tatlı' };

export default function RecipesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // FIX (audit UX-PRM-06): ekranın kendisi premium-koruması yapsın — menü ternary'sine güvenme
  // (deep link / chat navigate / deneme bitişi free kullanıcıyı içeride bırakıyordu).
  const { isPremium } = usePremium();
  const profileLoading = useProfileStore(s => s.loading);
  const profile = useProfileStore(s => s.profile);
  const [recipes, setRecipes] = useState<SavedRecipe[]>([]);
  // FIX (audit UI-STA-03): yükleme durumu — ilk fetch bitene kadar veri olan kullanıcıya yanlış 'boş' kartı gösterilmiyordu.
  const [loading, setLoading] = useState(true);
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

  // FIX (audit UX-PRM-06): profil çözüldükten sonra premium değilse paywall'a yönlendir
  // (profil null/yükleniyorken yönlendirme yok — geçici null premium kullanıcıyı atmasın).
  useEffect(() => {
    if (!profileLoading && profile !== null && !isPremium) {
      router.replace('/settings/premium');
    }
  }, [profileLoading, profile, isPremium, router]);

  useEffect(() => { load(); }, [filter]);
  const load = () => getRecipes(filter ?? undefined).then(setRecipes).finally(() => setLoading(false));

  const handleDelete = (id: string) => {
    Alert.alert('Sil', 'Tarifi silmek istediğine emin misin?', [
      { text: 'İptal' },
      { text: 'Sil', style: 'destructive', onPress: async () => {
        try {
          await deleteRecipe(id);
        } catch {
          haptics.error();
          Alert.alert('Hata', 'Tarif silinemedi, tekrar dene.');
          return;
        }
        haptics.success();
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
    // FIX (audit UX-FRM-05): guard against blank title overwriting the saved recipe name
    if (!editTitle.trim()) { haptics.error(); Alert.alert('Eksik', 'Tarif adı boş olamaz.'); return; }
    const servingsNum = parseInt(editServings, 10);
    try {
      await updateRecipe(editingId, {
        title: editTitle.trim(),
        instructions: editInstructions.trim(),
        servings: isNaN(servingsNum) ? 1 : servingsNum,
      });
    } catch {
      haptics.error();
      Alert.alert('Hata', 'Tarif kaydedilemedi, tekrar dene.');
      return;
    }
    haptics.success();
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
      Alert.alert('İkame Bulunamadı', `"${ingredientName}" için bilinen bir ikame yok.`);
      return;
    }
    haptics.tap();
    setSubstitutions(prev => ({ ...prev, [`${recipeId}:${ingredientName}`]: subs }));
  };

  // P1#2: Favorite toggle + "cooked it" use-count (feeds ai-plan's saved-recipe preference query)
  const handleToggleFavorite = async (r: SavedRecipe) => {
    const next = !(r.is_favorite ?? false);
    haptics.tap();
    setRecipes(prev => prev.map(x => x.id === r.id ? { ...x, is_favorite: next } : x));
    await toggleFavorite(r.id, r.is_favorite ?? false);
  };

  const handleCooked = async (r: SavedRecipe) => {
    haptics.success();
    setRecipes(prev => prev.map(x => x.id === r.id ? { ...x, use_count: (x.use_count ?? 0) + 1 } : x));
    await incrementUseCount(r.id);
    Alert.alert('İşaretlendi', `"${r.title}" kullanıldı olarak kaydedildi. Koç haftalık plan yaparken sık kullandığın tarifleri tercih eder.`);
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

  // FIX (audit UX-PRM-06): premium olmayan kullanıcıya içerik gösterme — yönlendirme efekti devredeyken boş ekran.
  if (!isPremium && profile !== null && !profileLoading) {
    return <View style={{ flex: 1, backgroundColor: COLORS.background }} />;
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior="padding">
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
      {/* FIX (audit duplicate-title): Native header renders the title; in-body H1 removed as redundant. */}
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginTop: SPACING.xs, marginBottom: SPACING.lg }}>Koçundan aldığın tarifleri burada bulabilirsin.</Text>

      {/* Filter */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.md }}>
        <TouchableOpacity onPress={() => { haptics.tap(); setFilter(null); }}
          accessibilityRole="button"
          accessibilityLabel="Tüm tarifler"
          accessibilityState={{ selected: !filter }}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          style={{ paddingVertical: SPACING.xs, paddingHorizontal: SPACING.sm, borderRadius: RADIUS.sm, backgroundColor: !filter ? COLORS.primary : 'transparent', borderWidth: 1, borderColor: !filter ? COLORS.primary : COLORS.border }}>
          <Text style={{ color: !filter ? getContrastColor(COLORS.primary) : COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600' }}>Tümü</Text>
        </TouchableOpacity>
        {Object.entries(CAT_LABELS).map(([key, label]) => (
          <TouchableOpacity key={key} onPress={() => { haptics.tap(); setFilter(key); }}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: filter === key }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            style={{ paddingVertical: SPACING.xs, paddingHorizontal: SPACING.sm, borderRadius: RADIUS.sm, backgroundColor: filter === key ? COLORS.primary : 'transparent', borderWidth: 1, borderColor: filter === key ? COLORS.primary : COLORS.border }}>
            <Text style={{ color: filter === key ? getContrastColor(COLORS.primary) : COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600' }}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* P1#10: "Elimde sunlar var" ingredient match */}
      <View style={{ flexDirection: 'row', gap: SPACING.xs, marginBottom: SPACING.md }}>
        <TextInput
          style={[inputStyle, { flex: 1 }]}
          value={ingredientQuery}
          onChangeText={setIngredientQuery}
          placeholder="Elimde: tavuk, pirinç, brokoli"
          placeholderTextColor={COLORS.textMuted}
        />
        <TouchableOpacity onPress={() => { haptics.tap(); handleIngredientSearch(); }}
          accessibilityRole="button"
          accessibilityLabel="Malzemelere göre tarif ara"
          style={{ paddingHorizontal: SPACING.md, justifyContent: 'center', borderRadius: RADIUS.sm, backgroundColor: COLORS.primary }}>
          <Text style={{ color: getContrastColor(COLORS.primary), fontSize: FONT.sm, fontWeight: '600' }}>Ara</Text>
        </TouchableOpacity>
      </View>
      {ingredientMatches !== null && (
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, marginBottom: SPACING.sm }}>
          {ingredientMatches.length > 0 ? `${ingredientMatches.length} tarif eşleşti (en az %50 malzeme).` : 'Eşleşen tarif yok. Koçundan bu malzemelerle tarif iste.'}
        </Text>
      )}

      {/* FIX (audit UI-STA-03): ilk fetch sürerken boş-durum kartı yerine yükleniyor göstergesi. */}
      {loading ? (
        <View style={{ gap: SPACING.md, paddingTop: SPACING.md }}>
          <SkeletonCard lines={3} />
          <SkeletonCard lines={2} />
        </View>
      ) : recipes.length === 0 ? (
        <Card>
          {/* FIX (ux-polish): iconed empty state to match the app's empty-state pattern. */}
          <View style={{ alignItems: 'center', paddingVertical: SPACING.xl, gap: SPACING.sm }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.surfaceLight, justifyContent: 'center', alignItems: 'center' }}>
              <Ionicons name="book-outline" size={26} color={COLORS.primary} />
            </View>
            <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '700', textAlign: 'center' }}>Henüz kayıtlı tarifin yok</Text>
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, textAlign: 'center' }}>Koçundan tarif iste ve "Kaydet" de.</Text>
          </View>
        </Card>
      ) : (
        recipes.map(r => (
          <TouchableOpacity key={r.id}
            accessibilityRole="button"
            accessibilityLabel={r.title}
            accessibilityHint="Detayları görmek için dokun, silmek için basılı tut"
            accessibilityState={{ expanded: expanded === r.id }}
            onPress={() => { if (editingId !== r.id) { haptics.tap(); setExpanded(expanded === r.id ? null : r.id); } }} onLongPress={() => handleDelete(r.id)}>
            <Card>
              {editingId === r.id ? (
                /* Edit Mode */
                <View style={{ gap: SPACING.sm }}>
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600' }}>TARİF DÜZENLE</Text>
                  <TextInput
                    style={inputStyle}
                    value={editTitle}
                    onChangeText={setEditTitle}
                    placeholder="Tarif adı"
                    placeholderTextColor={COLORS.textMuted}
                  />
                  <TextInput
                    style={[inputStyle, { height: 100, textAlignVertical: 'top' }]}
                    value={editInstructions}
                    onChangeText={setEditInstructions}
                    placeholder="Yapılışı"
                    placeholderTextColor={COLORS.textMuted}
                    multiline
                  />
                  <TextInput
                    style={inputStyle}
                    value={editServings}
                    onChangeText={setEditServings}
                    placeholder="Porsiyon sayısı"
                    placeholderTextColor={COLORS.textMuted}
                    keyboardType="numeric"
                  />
                  <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                    <TouchableOpacity onPress={saveEdit}
                      accessibilityRole="button" accessibilityLabel="Tarifi kaydet"
                      style={{ flex: 1, paddingVertical: SPACING.sm, borderRadius: RADIUS.sm, backgroundColor: COLORS.success, alignItems: 'center' }}>
                      <Text style={{ color: getContrastColor(COLORS.success), fontSize: FONT.sm, fontWeight: '600' }}>Kaydet</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => { haptics.tap(); cancelEdit(); }}
                      accessibilityRole="button" accessibilityLabel="Düzenlemeyi iptal et"
                      style={{ flex: 1, paddingVertical: SPACING.sm, borderRadius: RADIUS.sm, backgroundColor: COLORS.surfaceLight, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border }}>
                      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '600' }}>İptal</Text>
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
                    <TouchableOpacity onPress={() => handleToggleFavorite(r)}
                      accessibilityRole="button"
                      accessibilityLabel={r.is_favorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={{ paddingHorizontal: SPACING.xs }}>
                      <Text style={{ fontSize: 18, color: r.is_favorite ? COLORS.warning : COLORS.textMuted }}>{r.is_favorite ? '★' : '☆'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDelete(r.id)}
                      accessibilityRole="button"
                      accessibilityLabel="Tarifi sil"
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={{ width: 44, height: 44, justifyContent: 'center', alignItems: 'center' }}>
                      <Ionicons name="trash-outline" size={20} color={COLORS.textMuted} />
                    </TouchableOpacity>
                    <Text style={{ color: COLORS.textMuted, fontSize: FONT.md }}>{expanded === r.id ? '−' : '+'}</Text>
                  </View>

                  {expanded === r.id && (() => {
                    const display = getDisplayRecipe(r);
                    const currentScaling = scalingServings[r.id] ?? r.servings;
                    return (
                    <View style={{ marginTop: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: SPACING.md }}>
                      {/* D9: Portion Scaler */}
                      <View style={{ marginBottom: SPACING.md }}>
                        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginBottom: SPACING.xs }}>PORSİYON</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
                          {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                            <TouchableOpacity key={n} onPress={() => { haptics.tap(); handleScale(r, n); }}
                              accessibilityRole="button"
                              accessibilityLabel={`${n} porsiyon`}
                              accessibilityState={{ selected: currentScaling === n }}
                              style={{
                                width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center',
                                backgroundColor: currentScaling === n ? COLORS.primary : COLORS.surfaceLight,
                                borderWidth: 1, borderColor: currentScaling === n ? COLORS.primary : COLORS.border,
                              }}>
                              <Text style={{ color: currentScaling === n ? getContrastColor(COLORS.primary) : COLORS.text, fontSize: FONT.sm, fontWeight: '600' }}>{n}</Text>
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
                                accessibilityRole="button"
                                accessibilityLabel={`${ing.name} için ikame öner`}
                                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                                style={{ paddingVertical: SPACING.xs, paddingHorizontal: SPACING.sm, borderRadius: RADIUS.sm, backgroundColor: COLORS.surfaceLight, borderWidth: 1, borderColor: COLORS.border }}>
                                <Text style={{ color: COLORS.primary, fontSize: FONT.xs, fontWeight: '600' }}>İkame</Text>
                              </TouchableOpacity>
                            </View>
                            {/* D10: Show substitutions */}
                            {subs && subs.length > 0 && (
                              <View style={{ marginLeft: SPACING.md, marginBottom: SPACING.xs }}>
                                {subs.map((sub, si) => (
                                  <View key={si} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 2 }}>
                                    <Text style={{ color: COLORS.success, fontSize: FONT.xs }}>  &rarr; {sub.replacement}</Text>
                                    <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginLeft: SPACING.xs }}>({sub.note_tr})</Text>
                                  </View>
                                ))}
                              </View>
                            )}
                          </View>
                        );
                      })}

                      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginTop: SPACING.md, marginBottom: SPACING.xs }}>YAPILIŞI</Text>
                      <Text style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 22 }}>{display.instructions}</Text>
                      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: SPACING.sm }}>{display.servings} porsiyon</Text>
                      <View style={{ flexDirection: 'row', gap: SPACING.lg, marginTop: SPACING.sm }}>
                        <TouchableOpacity onPress={() => { haptics.tap(); startEdit(r); }}
                          accessibilityRole="button" accessibilityLabel="Tarifi düzenle"
                          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                          style={{ paddingVertical: SPACING.xs }}>
                          <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '600' }}>Düzenle</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleCooked(r)}
                          accessibilityRole="button" accessibilityLabel="Pişirdim olarak işaretle"
                          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                          style={{ paddingVertical: SPACING.xs }}>
                          <Text style={{ color: COLORS.success, fontSize: FONT.sm, fontWeight: '600' }}>Pişirdim ✓</Text>
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
        <Button title="AI'dan Tarif Öner" onPress={navigateToChat} variant="outline" />
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const inputStyle = {
  backgroundColor: COLORS.inputBg,
  borderRadius: RADIUS.sm,
  padding: SPACING.sm,
  color: COLORS.text,
  fontSize: FONT.sm,
  borderWidth: 1,
  borderColor: COLORS.border,
};
