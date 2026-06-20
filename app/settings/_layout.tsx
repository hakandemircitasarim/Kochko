import { Stack } from 'expo-router';
import { useTheme } from '@/lib/theme';

export default function SettingsLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Ayarlar' }} />
      <Stack.Screen name="account-security" options={{ title: 'Hesap Güvenliği' }} />
      <Stack.Screen name="achievements" options={{ title: 'Başarımlar' }} />
      <Stack.Screen name="challenges" options={{ title: "Challenge'lar" }} />
      <Stack.Screen name="chat-history" options={{ title: 'Sohbet Geçmişi' }} />
      <Stack.Screen name="coach-memory" options={{ title: 'Koç Hafızası' }} />
      <Stack.Screen name="coach-sharing" options={{ title: 'Koç Paylaşımı' }} />
      <Stack.Screen name="coach-tone" options={{ title: 'Koç Tonu' }} />
      <Stack.Screen name="data-import" options={{ title: 'Veri İçeri Aktar' }} />
      <Stack.Screen name="day-boundary" options={{ title: 'Gün Dönümü' }} />
      <Stack.Screen name="debug-mode" options={{ title: 'Geliştirici Modu' }} />
      <Stack.Screen name="edit-profile" options={{ title: 'Profil Düzenle' }} />
      <Stack.Screen name="food-preferences" options={{ title: 'Yemek Tercihleri' }} />
      <Stack.Screen name="goals" options={{ title: 'Hedef Ayarları' }} />
      <Stack.Screen name="health-events" options={{ title: 'Sağlık Geçmişi' }} />
      <Stack.Screen name="health-export" options={{ title: 'Sağlık Profesyoneli Raporu' }} />
      <Stack.Screen name="household" options={{ title: 'Aile Planı' }} />
      <Stack.Screen name="if-settings" options={{ title: 'Aralıklı Oruç (IF)' }} />
      <Stack.Screen name="lab-values" options={{ title: 'Lab Değerleri' }} />
      <Stack.Screen name="meal-prep-plan" options={{ title: 'Meal Prep Planı' }} />
      <Stack.Screen name="meal-templates" options={{ title: 'Favori Öğünler' }} />
      <Stack.Screen name="menstrual" options={{ title: 'Regl Döngüsü' }} />
      <Stack.Screen name="multi-phase-goals" options={{ title: 'Çok Fazlı Hedef' }} />
      <Stack.Screen name="notifications" options={{ title: 'Bildirimler' }} />
      <Stack.Screen name="periodic-state" options={{ title: 'Dönemsel Durum' }} />
      <Stack.Screen name="premium" options={{ title: "Premium'a Geç" }} />
      <Stack.Screen name="progress-photos" options={{ title: 'İlerleme Fotoğrafları' }} />
      <Stack.Screen name="recipes" options={{ title: 'Tarif Kütüphanesi' }} />
      <Stack.Screen name="strength" options={{ title: 'Güç Progresyon' }} />
      <Stack.Screen name="supplements" options={{ title: 'Supplement Takibi' }} />
      <Stack.Screen name="theme" options={{ title: 'Tema' }} />
      <Stack.Screen name="venues" options={{ title: 'Mekanlar' }} />
      <Stack.Screen name="weekly-menu" options={{ title: 'Haftalık Menü' }} />
    </Stack>
  );
}
