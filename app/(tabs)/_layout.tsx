import { Tabs, router } from 'expo-router';
import { View, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';

const TEAL = '#1D9E75';
const MUTED = '#66667A';

type IconName = 'home' | 'chatbubble-ellipses' | 'add' | 'bar-chart' | 'person';

function TabIcon({ name, focused }: { name: IconName; focused: boolean }) {
  const outlineName = `${name}-outline` as keyof typeof Ionicons.glyphMap;
  return (
    <Ionicons
      name={focused ? name : outlineName}
      size={22}
      color={focused ? TEAL : MUTED}
    />
  );
}

function FABButton() {
  return (
    <TouchableOpacity
      style={styles.fab}
      onPress={() => router.push('/log')}
      activeOpacity={0.8}
    >
      <Ionicons name="add" size={28} color="#FFFFFF" />
    </TouchableOpacity>
  );
}

export default function TabLayout() {
  const { colors, isDark } = useTheme();

  return (
    <Tabs screenOptions={{
      tabBarStyle: {
        backgroundColor: colors.tabBar,
        borderTopColor: colors.tabBarBorder,
        borderTopWidth: 0.5,
        height: Platform.OS === 'web' ? 64 : 84,
        paddingBottom: Platform.OS === 'web' ? 8 : 28,
        paddingTop: 8,
        elevation: 0,
      },
      tabBarActiveTintColor: TEAL,
      tabBarInactiveTintColor: MUTED,
      tabBarLabelStyle: {
        fontSize: 10,
        fontWeight: '500',
        marginTop: 2,
      },
      headerShown: false,
    }}>
      <Tabs.Screen name="index" options={{
        title: 'Ana Sayfa',
        tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} />,
      }} />
      <Tabs.Screen name="chat" options={{
        title: 'Koc',
        tabBarIcon: ({ focused }) => <TabIcon name="chatbubble-ellipses" focused={focused} />,
      }} />
      {/* Center FAB — placeholder tab that opens modal */}
      <Tabs.Screen name="plan" options={{
        title: '',
        tabBarIcon: () => null,
        tabBarButton: () => <FABButton />,
      }} />
      <Tabs.Screen name="progress" options={{
        title: 'Raporlar',
        tabBarIcon: ({ focused }) => <TabIcon name="bar-chart" focused={focused} />,
      }} />
      <Tabs.Screen name="profile" options={{
        title: 'Profil',
        tabBarIcon: ({ focused }) => <TabIcon name="person" focused={focused} />,
      }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: TEAL,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -20,
  },
});
