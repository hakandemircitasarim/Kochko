import { haptics } from '@/lib/haptics';
import { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard';

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
  // FIX (ux-audit device-fix): if the profile store isn't populated yet at mount, `selected` seeds
  // the 'balanced' default; when the profile later loads, sync ONCE so we don't (a) fire a spurious
  // unsaved-changes prompt and (b) let Kaydet clobber the real saved tone with the default.
  const hydratedRef = useRef(!!profile?.coach_tone);
  useEffect(() => {
    if (!hydratedRef.current && profile?.coach_tone) {
      hydratedRef.current = true;
      setSelected(profile.coach_tone as Tone);
    }
  }, [profile?.coach_tone]);
  // FIX (ux-round3 #8): warn before discarding an unsaved tone change. `update` writes the
  // store baseline, so after a successful save/reset `dirty` is false and back is not blocked.
  useUnsavedGuard(selected !== ((profile?.coach_tone as Tone) ?? 'balanced'));

  // ux-sweep (F4): update throw'u yakalanmıyordu — ağ hatasında sessiz hiçlik.
  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    if (!user?.id || saving) return;
    setSaving(true);
    try {
      await update(user.id, { coach_tone: selected } as never);
      Alert.alert('Kaydedildi', `Koç tonu "${TONES.find(t => t.value === selected)?.label}" olarak ayarlandı.`, [
        { text: 'Tamam', onPress: () => router.back() },
      ]);
    } catch {
      haptics.error();
      Alert.alert('Kaydedilemedi', 'Bağlantını kontrol edip tekrar dene.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    // FIX (ux-round4 #15): the old copy claimed this wiped "AI'ın öğrendiği ton tercihi",
    // but it only sets coach_tone='balanced'. The learned preference lives in
    // ai_summary.learned_tone_preference (shown in Koç Hafızası) and is untouched — so the
    // copy is now honest about what actually happens and points to where the learned tone is.
    Alert.alert('Tonu sıfırla', 'Ton tercihin "Dengeli"ye dönecek. (Koçun zamanla öğrendiği tonu ayrıca Koç Hafızası\'ndan temizleyebilirsin.)', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sıfırla', style: 'destructive', onPress: async () => {
        if (user?.id) await update(user.id, { coach_tone: 'balanced' } as never);
        setSelected('balanced');
      }},
    ]);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      {/* FIX (audit duplicate-title): Native header renders the title; in-body H1 removed as redundant. */}
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginTop: SPACING.xs, marginBottom: SPACING.lg, lineHeight: 20 }}>
        Koçunun seninle nasıl konuşmasını istediğini seç. AI zamanla tepkilerinden otomatik de öğrenir.
      </Text>

      {TONES.map(tone => (
        <TouchableOpacity key={tone.value} onPress={() => setSelected(tone.value)}
          accessibilityRole="radio"
          accessibilityState={{ selected: selected === tone.value }}
          accessibilityLabel={tone.label}>
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

      <Button title="Kaydet" onPress={handleSave} size="lg" style={{ marginTop: SPACING.md }}  loading={saving} />
      <Button title="Tonu Sıfırla" variant="ghost" onPress={handleReset} style={{ marginTop: SPACING.sm }} />
    </ScrollView>
  );
}
