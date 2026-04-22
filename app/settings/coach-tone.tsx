import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

type Tone = 'strict' | 'balanced' | 'gentle';

const TONES: { value: Tone; label: string; desc: string; example: string }[] = [
  {
    value: 'strict',
    label: 'Sert Koç',
    desc: 'Direkt, açık, net. Mazerete yer yok. Disiplin ön planda.',
    example: '"Bugün hedefin 1700 kcal, 2100 yemişsin. Yarın bunu telafi et, sebebini biliyorsun."',
  },
  {
    value: 'balanced',
    label: 'Dengeli',
    desc: 'Samimi ama profesyonel. Empati var, ama laf kalabalığı yok.',
    example: '"Bugün biraz fazla oldu ama haftalık bütçende hâlâ marjın var. Yarın hafif tut, denge kurulur."',
  },
  {
    value: 'gentle',
    label: 'Yumuşak Destekleyici',
    desc: 'Anlayışlı, sabırlı, teşvik edici. Motivasyon ön planda.',
    example: '"Her gün mükemmel olmak zorunda değilsin. Bugün saptın ama yarın yeni bir gün. Sana güveniyorum."',
  },
];

export default function CoachToneScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const { profile, update } = useProfileStore();
  const [selected, setSelected] = useState<Tone>((profile?.coach_tone as Tone) ?? 'balanced');

  const handleSave = async () => {
    if (!user?.id) return;
    await update(user.id, { coach_tone: selected } as never);
    Alert.alert('Kaydedildi', `Koç tonu "${TONES.find(t => t.value === selected)?.label}" olarak ayarlandı.`, [
      { text: 'Tamam', onPress: () => router.back() },
    ]);
  };

  const handleReset = () => {
    Alert.alert('Sıfırla', 'AI\'ın öğrendiği ton tercihi sıfırlanacak, başlangıç tonuna dönülecek.', [
      { text: 'İptal' },
      { text: 'Sıfırla', onPress: async () => {
        if (user?.id) await update(user.id, { coach_tone: 'balanced' } as never);
        setSelected('balanced');
      }},
    ]);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Koç Tonu</Text>
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg, lineHeight: 20 }}>
        Koçunun seninle nasıl konuşmasını istediğini seç. AI zamanla tepkilerinden otomatik de öğrenir.
      </Text>

      {TONES.map(tone => (
        <TouchableOpacity key={tone.value} onPress={() => setSelected(tone.value)}>
          <Card style={{ borderColor: selected === tone.value ? COLORS.primary : COLORS.border, borderWidth: selected === tone.value ? 2 : 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.xs }}>
              <Text style={{ color: selected === tone.value ? COLORS.primary : COLORS.text, fontSize: FONT.lg, fontWeight: '700' }}>{tone.label}</Text>
              {selected === tone.value && <Text style={{ color: COLORS.primary, fontSize: FONT.md }}>Seçili</Text>}
            </View>
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.sm }}>{tone.desc}</Text>
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, fontStyle: 'italic', lineHeight: 20 }}>{tone.example}</Text>
          </Card>
        </TouchableOpacity>
      ))}

      <Button title="Kaydet" onPress={handleSave} size="lg" style={{ marginTop: SPACING.md }} />
      <Button title="Tonu Sıfırla" variant="ghost" onPress={handleReset} style={{ marginTop: SPACING.sm }} />
    </ScrollView>
  );
}
