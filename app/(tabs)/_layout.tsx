import { useEffect, useRef, useState } from 'react';
import { Tabs, router } from 'expo-router';
import { View, Text, TouchableOpacity, Platform, StyleSheet, Animated, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';
import { SPACING, RADIUS, FONT, WATER_INCREMENT } from '@/lib/constants';
import { useProfileStore } from '@/stores/profile.store';
import { useAuthStore } from '@/stores/auth.store';
import { useDashboardStore } from '@/stores/dashboard.store';
import { showToast } from '@/components/ui/Toast';

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
  const insets = useSafeAreaInsets();
  // FIX (ux-round2 #9, adversarial-review): 'Su' now logs a glass directly (one tap) instead of
  // duplicating 'Öğün' — there's no water sub-screen to jump to.
  const user = useAuthStore(s => s.user);
  const addWater = useDashboardStore(s => s.addWater);
  const dayBoundaryHour = useProfileStore(s => (s.profile?.day_boundary_hour as number) ?? 4);
  const lastPushRef = useRef(0);
  // FIX (ux-round2 #1): the app's most-tapped, most-'premium' button was silent — every other
  // logging path fires haptics + press feedback. Add a tactile tap + a spring press-scale.
  const scale = useRef(new Animated.Value(1)).current;
  // FIX (ux-round2 #9): long-press → quick menu that jumps straight to a log sub-screen (su/tartı/
  // uyku/toparlanma/antrenman) — saves the open-then-pick second tap. Short tap unchanged.
  const [menuOpen, setMenuOpen] = useState(false);
  const OPTIONS: { label: string; icon: keyof typeof Ionicons.glyphMap; run: () => void }[] = [
    { label: 'Öğün', icon: 'restaurant-outline', run: () => router.push('/log') },
    { label: 'Su (+250 ml)', icon: 'water-outline', run: () => { if (user?.id) addWater(user.id, WATER_INCREMENT, dayBoundaryHour).then(() => showToast('Su eklendi', { variant: 'success' })).catch(() => {}); } },
    { label: 'Tartı', icon: 'scale-outline', run: () => router.push('/log?to=weight' as never) },
    { label: 'Uyku', icon: 'moon-outline', run: () => router.push('/log?to=sleep' as never) },
    { label: 'Antrenman', icon: 'barbell-outline', run: () => router.push({ pathname: '/(tabs)/chat', params: { prefill: 'Bugün antrenman yaptım: ', taskNonce: String(Date.now()) } }) },
    { label: 'Toparlanma', icon: 'fitness-outline', run: () => router.push('/log?to=recovery' as never) },
  ];
  return (
    <View style={styles.fabContainer}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: colors.primary }]}
          onPressIn={() => Animated.spring(scale, { toValue: 0.9, friction: 6, useNativeDriver: true }).start()}
          onPressOut={() => Animated.spring(scale, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }).start()}
          onPress={() => {
            const now = Date.now();
            if (now - lastPushRef.current < 800) return;
            lastPushRef.current = now;
            haptics.tap();
            router.push('/log');
          }}
          onLongPress={() => { haptics.tap(); setMenuOpen(true); }}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Hızlı kayıt — öğün, su, tartı, antrenman. Uzun bas: hızlı menü"
        >
          <Ionicons name="add" size={28} color={getContrastColor(colors.primary)} />
        </TouchableOpacity>
      </Animated.View>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setMenuOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Kapat"
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
        >
          <View
            onStartShouldSetResponder={() => true}
            style={{
              backgroundColor: colors.card, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
              borderWidth: 0.5, borderColor: colors.border,
              paddingTop: SPACING.lg, paddingBottom: insets.bottom + SPACING.lg, paddingHorizontal: SPACING.xl,
            }}
          >
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs, fontWeight: '700', letterSpacing: 0.5, marginBottom: SPACING.sm }}>HIZLI KAYIT</Text>
            {OPTIONS.map((o) => (
              <TouchableOpacity
                key={o.label}
                onPress={() => { haptics.tap(); setMenuOpen(false); o.run(); }}
                accessibilityRole="button"
                accessibilityLabel={o.label}
                style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingVertical: SPACING.md }}
              >
                <View style={{ width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: colors.primary + '18', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={o.icon} size={18} color={colors.primary} />
                </View>
                <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '600' }}>{o.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
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
      {/* FIX (ux-polish): the four real tabs were silent while the center FAB taps with haptics —
          tabPress listener adds the same tactile feedback without touching nav/render. */}
      <Tabs.Screen name="index" options={{
        title: 'Ana Sayfa',
        tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} />,
      }} listeners={{ tabPress: () => haptics.tap() }} />
      <Tabs.Screen name="chat" options={{
        title: 'Kochko',
        tabBarIcon: ({ focused }) => <TabIcon name="chatbubble-ellipses" focused={focused} />,
      }} listeners={{ tabPress: () => haptics.tap() }} />
      <Tabs.Screen name="plan" options={{
        title: '',
        tabBarIcon: () => null,
        tabBarButton: () => <FABButton />,
      }} />
      <Tabs.Screen name="progress" options={{
        title: 'Raporlar',
        tabBarIcon: ({ focused }) => <TabIcon name="bar-chart" focused={focused} />,
      }} listeners={{ tabPress: () => haptics.tap() }} />
      <Tabs.Screen name="profile" options={{
        title: 'Profil',
        tabBarIcon: ({ focused }) => <TabIcon name="person" focused={focused} />,
      }} listeners={{ tabPress: () => haptics.tap() }} />
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
