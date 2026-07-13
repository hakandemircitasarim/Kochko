import { useEffect, useRef } from 'react';
import { Tabs, router } from 'expo-router';
import { View, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { getContrastColor } from '@/lib/accessibility';
import { useProfileStore } from '@/stores/profile.store';

type IconName = 'home' | 'chatbubble-ellipses' | 'add' | 'bar-chart' | 'person';

function TabIcon({ name, focused }: { name: IconName; focused: boolean }) {
  const { colors } = useTheme();
  const outlineName = `${name}-outline` as keyof typeof Ionicons.glyphMap;
  return (
    <Ionicons
      name={focused ? name : outlineName}
      size={22}
      color={focused ? colors.primary : colors.textSecondary}
    />
  );
}

function FABButton() {
  const { colors } = useTheme();
  // FIX (ux-pass5): hızlı çift dokunuş iki /log modalını üst üste yığıyordu (expo-router
  // push duplike rotaya izin verir; log.tsx'in auto router.back'i yalnız üsttekini kapatınca
  // altta aynı ekran yeniden beliriyordu). Kısa pencere içinde ikinci push yutulur.
  const lastPushRef = useRef(0);
  return (
    <View style={styles.fabContainer}>
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.primary }]}
        onPress={() => {
          const now = Date.now();
          if (now - lastPushRef.current < 800) return;
          lastPushRef.current = now;
          router.push('/log');
        }}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Hızlı kayıt — öğün, su, tartı, antrenman"
      >
        <Ionicons name="add" size={28} color={getContrastColor(colors.primary)} />
      </TouchableOpacity>
    </View>
  );
}

export default function TabLayout() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // FIX (audit UX-ONB-04): defense-in-depth onboarding gate. index.tsx is the
  // primary guard, but any navigation that reaches a (tabs) route without passing
  // through it (future deep link, router.replace) would otherwise enter the authed
  // app with onboarding incomplete. Only redirect when the profile is loaded AND
  // onboarding_completed is explicitly false — never while it's null/loading, so
  // this can't fight index.tsx's routing or loop.
  const profile = useProfileStore((s) => s.profile);
  const onboardingIncomplete = !!profile && !profile.onboarding_completed;
  useEffect(() => {
    if (onboardingIncomplete) router.replace('/onboarding');
  }, [onboardingIncomplete]);

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
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.textSecondary,
      tabBarLabelStyle: {
        fontSize: 11,
        fontWeight: '500',
        marginTop: 0,
      },
      tabBarIconStyle: {
        marginBottom: -2,
      },
      // ux-pass2: the chat thread lives inside its tab now — hide the bar while the
      // keyboard is up so the composer sits directly on the keyboard.
      tabBarHideOnKeyboard: true,
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
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -16,
  },
});
