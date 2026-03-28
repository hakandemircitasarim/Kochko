import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { getTemplates, createTemplate, deleteTemplate, useTemplate, type MealTemplate } from '@/services/templates.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function MealTemplatesScreen() {
  const [templates, setTemplates] = useState<MealTemplate[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [itemsText, setItemsText] = useState('');

  useEffect(() => { load(); }, []);
  const load = () => getTemplates().then(setTemplates);

  const handleAdd = async () => {
    if (!name.trim() || !itemsText.trim()) {
      Alert.alert('Hata', 'Sablon adi ve icerik gerekli.');
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
    if (error) { Alert.alert('Hata', error); return; }
    setShowAdd(false); setName(''); setItemsText('');
    load();
  };

  const handleUse = async (t: MealTemplate) => {
    await useTemplate(t.id);
    // In a real flow, this would add the template items to today's meal log
    // For now we just increment usage and show confirmation
    Alert.alert('Kullanildi', `"${t.name}" sablonu kullanildi. Kocuna yazarak da hizlica girebilirsin.`);
    load();
  };

  const handleDelete = (id: string) => {
    Alert.alert('Sil', 'Sablonu silmek istediginize emin misiniz?', [
      { text: 'Iptal' },
      { text: 'Sil', style: 'destructive', onPress: () => { deleteTemplate(id); setTemplates(prev => prev.filter(t => t.id !== id)); } },
    ]);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Favori Ogunler</Text>
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg, lineHeight: 20 }}>
        Sik yedigin kombinasyonlari kaydet, tek dokunusla tekrar gir.
      </Text>

      <Button title={showAdd ? 'Iptal' : 'Yeni Sablon Olustur'} variant={showAdd ? 'ghost' : 'primary'} onPress={() => setShowAdd(!showAdd)} />

      {showAdd && (
        <Card style={{ marginTop: SPACING.md }}>
          <Input label="Sablon Adi" placeholder="Kahvalti klasigim" value={name} onChangeText={setName} />
          <Input
            label="Icerik (virgul ile ayir)"
            placeholder="2 yumurta 155kcal 13g pro, 1 ekmek 80kcal 3g pro"
            value={itemsText}
            onChangeText={setItemsText}
            multiline
            numberOfLines={3}
            style={{ minHeight: 70, textAlignVertical: 'top' }}
          />
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginBottom: SPACING.md }}>
            Format: yiyecek adi Xkcal Xg pro, ... (kocuna sorarak da sablon olusturabilirsin)
          </Text>
          <Button title="Kaydet" onPress={handleAdd} />
        </Card>
      )}

      {templates.length === 0 && !showAdd ? (
        <Card style={{ marginTop: SPACING.md }}>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.xl }}>
            Henuz sablon yok. Sik yedigin ogunleri kaydet veya kocuna "bunu sablona ekle" de.
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
              <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: SPACING.xs }}>{t.use_count}x kullanildi | Uzun bas: sil</Text>
            </Card>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}
