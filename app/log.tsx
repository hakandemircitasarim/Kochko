/**
 * Quick Log Modal
 * Allows fast meal/workout/water logging from anywhere in the app.
 */
import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { sendMessage } from '@/services/chat.service';
import { useAuthStore } from '@/stores/auth.store';
import { useDashboardStore } from '@/stores/dashboard.store';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS, CARD_SHADOW } from '@/lib/constants';

export default function QuickLogScreen() {
  const { colors, isDark } = useTheme();
  const user = useAuthStore(s => s.user);
  const fetchToday = useDashboardStore(s => s.fetchToday);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLog = async () => {
    if (!text.trim() || !user?.id) return;
    setLoading(true);
    try {
      const { error } = await sendMessage(text.trim());
      if (error) {
        Alert.alert('Hata', error);
      } else {
        await fetchToday(user.id);
        router.back();
      }
    } catch {
      Alert.alert('Hata', 'Bir sorun oluştu. Tekrar dene.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: SPACING.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={{ color: colors.textMuted, fontSize: FONT.md }}>İptal</Text>
        </TouchableOpacity>
        <Text style={{ color: colors.text, fontSize: FONT.lg, fontWeight: '700' }}>Hızlı Kayıt</Text>
        <TouchableOpacity onPress={handleLog} disabled={loading || !text.trim()}>
          <Text style={[{ color: colors.primary, fontSize: FONT.md, fontWeight: '700' }, (!text.trim() || loading) && { opacity: 0.4 }]}>
            {loading ? '...' : 'Kaydet'}
          </Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={{
          backgroundColor: colors.surface, borderRadius: RADIUS.lg,
          padding: SPACING.md, color: colors.text, fontSize: FONT.md,
          minHeight: 120, textAlignVertical: 'top',
          borderWidth: 1, borderColor: colors.border,
        }}
        placeholder="Örnek: 2 dilim ekmek, 1 yumurta, çay"
        placeholderTextColor={colors.textMuted}
        value={text}
        onChangeText={setText}
        multiline
        autoFocus
        maxLength={2000}
      />

      <View style={{ marginTop: SPACING.lg }}>
        <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '600', marginBottom: SPACING.sm }}>Örnekler:</Text>
        {[
          { icon: 'restaurant-outline', text: 'Kahvaltıda 2 yumurta 1 peynir yedim', color: '#FF6B6B' },
          { icon: 'barbell-outline', text: '30dk koştum', color: '#6C63FF' },
          { icon: 'scale-outline', text: '73.5 kg', color: '#EC4899' },
          { icon: 'water-outline', text: '2 bardak su içtim', color: '#56CCF2' },
        ].map((hint, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => setText(hint.text)}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
              paddingVertical: SPACING.sm, paddingHorizontal: SPACING.sm,
              marginBottom: SPACING.xs, borderRadius: RADIUS.md,
              backgroundColor: colors.surfaceLight,
            }}
          >
            <Ionicons name={hint.icon as any} size={16} color={hint.color} />
            <Text style={{ color: colors.textSecondary, fontSize: FONT.sm }}>{hint.text}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
