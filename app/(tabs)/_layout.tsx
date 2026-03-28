import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { COLORS } from '@/lib/constants';

function Icon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = { index: '●', chat: '◈', plan: '◆', progress: '▲', profile: '■' };
  return <Text style={{ fontSize: 20, color: focused ? COLORS.primary : COLORS.textMuted }}>{icons[name] ?? '○'}</Text>;
}

export default function TabLayout() {
  return (
    <Tabs screenOptions={{
      tabBarStyle: { backgroundColor: COLORS.surface, borderTopColor: COLORS.border, height: 60, paddingBottom: 8 },
      tabBarActiveTintColor: COLORS.primary, tabBarInactiveTintColor: COLORS.textMuted,
      headerStyle: { backgroundColor: COLORS.background }, headerTintColor: COLORS.text, headerShadowVisible: false,
    }}>
      <Tabs.Screen name="index" options={{ title: 'Bugun', tabBarIcon: ({ focused }) => <Icon name="index" focused={focused} /> }} />
      <Tabs.Screen name="chat" options={{ title: 'Koc', tabBarIcon: ({ focused }) => <Icon name="chat" focused={focused} /> }} />
      <Tabs.Screen name="plan" options={{ title: 'Plan', tabBarIcon: ({ focused }) => <Icon name="plan" focused={focused} /> }} />
      <Tabs.Screen name="progress" options={{ title: 'Ilerleme', tabBarIcon: ({ focused }) => <Icon name="progress" focused={focused} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profil', tabBarIcon: ({ focused }) => <Icon name="profile" focused={focused} /> }} />
    </Tabs>
  );
}
