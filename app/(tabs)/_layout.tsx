import { Tabs, router } from 'expo-router';
import { View, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
    <View style={styles.fabContainer}>
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/log')}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Hızlı kayıt — öğün, su, tartı, antrenman"
      >
        <Ionicons name="add" size={28} color="#FFFFFF" />
      </TouchableOpacity>
    </View>
  );
}

export default function TabLayout() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const tabBarPaddingBottom = isWeb ? 4 : Math.max(insets.bottom, 12);
  const tabBarHeight = isWeb ? 56 : 56 + tabBarPaddingBottom;

  return (
    <Tabs screenOptions={{
      tabBarStyle: {
        backgroundColor: colors.tabBar,
        borderTopColor: colors.tabBarBorder,
        borderTopWidth: 0.5,
        height: tabBarHeight,
        paddingBottom: tabBarPaddingBottom,
        paddingTop: 4,
        elevation: 0,
      },
      tabBarActiveTintColor: TEAL,
      tabBarInactiveTintColor: MUTED,
      tabBarLabelStyle: {
        fontSize: 10,
        fontWeight: '500',
        marginTop: 0,
      },
      tabBarIconStyle: {
        marginBottom: -2,
      },
      headerShown: false,
    }}>
      <Tabs.Screen name="index" options={{
        title: 'Ana Sayfa',
        tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} />,
      }} />
      <Tabs.Screen name="chat" options={{
        title: 'Kochko',
        tabBarIcon: ({ focused }) => <TabIcon name="chatbubble-ellipses" focused={focused} />,
      }} />
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
  fabContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: TEAL,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -16,
  },
});
