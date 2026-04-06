import { Tabs } from 'expo-router';
import { View, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { RADIUS, CARD_SHADOW } from '@/lib/constants';

type IconName = 'home' | 'chatbubble-ellipses' | 'calendar' | 'trending-up' | 'person';

function TabIcon({ name, focused, colors }: { name: IconName; focused: boolean; colors: any }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 4 }}>
      {focused && (
        <View style={{
          position: 'absolute',
          top: -4,
          width: 24,
          height: 3,
          borderRadius: 2,
          backgroundColor: colors.primary,
        }} />
      )}
      <Ionicons
        name={focused ? name : `${name}-outline` as keyof typeof Ionicons.glyphMap}
        size={22}
        color={focused ? colors.primary : colors.textMuted}
      />
    </View>
  );
}

export default function TabLayout() {
  const { colors, isDark } = useTheme();

  return (
    <Tabs screenOptions={{
      tabBarStyle: {
        backgroundColor: colors.tabBar,
        borderTopColor: isDark ? colors.tabBarBorder : 'transparent',
        borderTopWidth: isDark ? 0.5 : 0,
        height: Platform.OS === 'web' ? 64 : 84,
        paddingBottom: Platform.OS === 'web' ? 8 : 28,
        paddingTop: 8,
        elevation: isDark ? 0 : 8,
        ...(isDark ? {} : {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.06,
          shadowRadius: 8,
        }),
      },
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.textMuted,
      tabBarLabelStyle: {
        fontSize: 11,
        fontWeight: '600',
        marginTop: 2,
      },
      headerShown: false,
    }}>
      <Tabs.Screen name="index" options={{
        title: 'Bugün',
        tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} colors={colors} />,
      }} />
      <Tabs.Screen name="chat" options={{
        title: 'Koç',
        tabBarIcon: ({ focused }) => <TabIcon name="chatbubble-ellipses" focused={focused} colors={colors} />,
      }} />
      <Tabs.Screen name="plan" options={{
        title: 'Plan',
        tabBarIcon: ({ focused }) => <TabIcon name="calendar" focused={focused} colors={colors} />,
      }} />
      <Tabs.Screen name="progress" options={{
        title: 'İlerleme',
        tabBarIcon: ({ focused }) => <TabIcon name="trending-up" focused={focused} colors={colors} />,
      }} />
      <Tabs.Screen name="profile" options={{
        title: 'Profil',
        tabBarIcon: ({ focused }) => <TabIcon name="person" focused={focused} colors={colors} />,
      }} />
    </Tabs>
  );
}
