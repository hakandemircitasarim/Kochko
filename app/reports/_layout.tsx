import { Stack } from 'expo-router';
import { useTheme } from '@/lib/theme';

export default function ReportsLayout() {
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
      <Stack.Screen name="daily" options={{ title: 'Gün Sonu Raporu' }} />
      <Stack.Screen name="weekly" options={{ title: 'Haftalık Rapor' }} />
      <Stack.Screen name="monthly" options={{ title: 'Aylık Rapor' }} />
      <Stack.Screen name="all-time" options={{ title: 'Tüm Zamanlar' }} />
      <Stack.Screen name="calendar" options={{ title: 'Takvim' }} />
    </Stack>
  );
}
