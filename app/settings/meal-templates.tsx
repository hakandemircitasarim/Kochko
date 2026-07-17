import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createTemplate, deleteTemplate, useTemplate, type MealTemplate } from '@/services/templates.service';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function MealTemplatesScreen() {
  const insets = useSafeAreaInsets();
  const [templates, setTemplates] = useState<MealTemplate[]>([]);
  // FIX (audit UI-STA-03): yükleme durumu — ilk fetch bitene kadar veri olan kullanıcıya yanlış 'boş' kartı gösterilmiyordu.
  const [loading, setLoading] = useState(true);
  // FIX (audit empty-vs-error): getTemplates hataları []'a yutuyor — ekran doğrudan sorguluyor
  // ki fetch hatası 'şablon yok' yerine hata+tekrar dene kartı çizsin.
  const [loadError, setLoadError] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [itemsText, setItemsText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const { data, error } = await supabase.from('meal_templates').select('*').order('use_count', { ascending: false });
    if (error) {
      console.warn('meal_templates load failed', error);
      setLoadError(true);
    } else {
      setTemplates((data ?? []) as MealTemplate[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!name.trim() || !itemsText.trim()) {
      Alert.alert('Hata', 'Şablon adı ve içerik gerekli.');
      return;
    }

    // Parse simple format: "2 yumurta 155kcal 13g pro, 1 ekmek 80kcal 3g pro"
    const items = itemsText.split(',').map(part => {
      const trimmed = part.trim();
      const calMatch = trimmed.match(/(\d+)\s*kcal/i);
      const proMatch = trimmed.match(/(\d+)\s*g?\s*pro/i);
      const name = trimmed.replace(/\d+\s*kcal/i, '').replace(/\d+\s*g?\s*pro/i, '').trim();
      return {
        name: name || trimmed,
        portion: '1 porsiyon',
        calories: calMatch ? parseInt(calMatch[1]) : 0,
        protein_g: proMatch ? parseInt(proMatch[1]) : 0,
        carbs_g: 0,
        fat_g: 0,
      };
    });

    const { error } = await createTemplate(name.trim(), items);
    // FIX (audit error-message-sweep): ham hata metnini gösterme; sabit Türkçe mesaj + konsola teknik detay.
    if (error) { console.error('createTemplate error', error); Alert.alert('Hata', 'Şablon kaydedilemedi, lütfen tekrar dene.'); return; }
    setShowAdd(false); setName(''); setItemsText('');
    load();
  };

  const handleUse = async (t: MealTemplate) => {
    const { error } = await useTemplate(t.id);
    if (error) {
      // FIX (audit error-message-sweep): ham hata metnini gösterme; sabit Türkçe mesaj + konsola teknik detay.
      console.error('useTemplate error', error);
      Alert.alert('Kayıt yapılamadı', 'Şablon bugüne kaydedilemedi, lütfen tekrar dene.');
      return;
    }
    Alert.alert('Kaydedildi', `"${t.name}" bugüne kaydedildi.`);
    load();
  };

  const handleDelete = (id: string) => {
    Alert.alert('Sil', 'Şablonu silmek istediğine emin misin?', [
      { text: 'İptal' },
      { text: 'Sil', style: 'destructive', onPress: () => { deleteTemplate(id); setTemplates(prev => prev.filter(t => t.id !== id)); } },
    ]);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
      {/* FIX (audit duplicate-title): Native header renders the title; in-body H1 removed as redundant. */}
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginTop: SPACING.xs, marginBottom: SPACING.lg, lineHeight: 20 }}>
        Sık yediğin kombinasyonları kaydet, tek dokunuşla tekrar gir.
      </Text>

      <Button title={showAdd ? 'İptal' : 'Yeni Şablon Oluştur'} variant={showAdd ? 'ghost' : 'primary'} onPress={() => setShowAdd(!showAdd)} />

      {showAdd && (
        <Card style={{ marginTop: SPACING.md }}>
          <Input label="Şablon Adı" placeholder="Kahvaltı klasiğim" value={name} onChangeText={setName} />
          <Input
            label="İçerik (virgül ile ayır)"
            placeholder="2 yumurta 155kcal 13g pro, 1 ekmek 80kcal 3g pro"
            value={itemsText}
            onChangeText={setItemsText}
            multiline
            numberOfLines={3}
            style={{ minHeight: 70, textAlignVertical: 'top' }}
          />
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginBottom: SPACING.md }}>
            Format: yiyecek adı Xkcal Xg pro, ... (koçuna sorarak da şablon oluşturabilirsin)
          </Text>
          <Button title="Kaydet" onPress={handleAdd} />
        </Card>
      )}

      {/* FIX (audit UI-STA-03): ilk fetch sürerken boş-durum kartı yerine yükleniyor göstergesi. */}
      {loading ? (
        <View style={{ paddingVertical: SPACING.xl, alignItems: 'center' }}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : loadError ? (
        /* FIX (audit empty-vs-error): fetch hatası 'şablon yok' değil, hata+tekrar dene (shared LoadErrorState). */
        <Card style={{ marginTop: SPACING.md }}>
          <LoadErrorState embedded title="Şablonlar yüklenemedi" onRetry={load} />
        </Card>
      ) : templates.length === 0 && !showAdd ? (
        <Card style={{ marginTop: SPACING.md }}>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.xl }}>
            Henüz şablon yok. Sık yediğin öğünleri kaydet veya koçuna "bunu şablona ekle" de.
          </Text>
        </Card>
      ) : (
        templates.map(t => (
          <TouchableOpacity key={t.id} onPress={() => handleUse(t)} onLongPress={() => handleDelete(t.id)}>
            <Card style={{ marginTop: SPACING.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.xs }}>
                <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600', flex: 1 }}>{t.name}</Text>
                <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                  <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '600' }}>{t.total_calories} kcal</Text>
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>{t.total_protein}g pro</Text>
                </View>
              </View>
              {t.items.map((item, i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>{item.name}</Text>
                  <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{item.calories} kcal</Text>
                </View>
              ))}
              <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: SPACING.xs }}>{t.use_count}x kullanıldı | Uzun bas: sil</Text>
            </Card>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}
