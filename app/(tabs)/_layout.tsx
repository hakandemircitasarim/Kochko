import { Tabs } from 'expo-router';
import { View, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS } from '@/lib/constants';

type IconName = 'home' | 'chatbubble-ellipses' | 'calendar' | 'trending-up' | 'person';

function TabIcon({ name, focused }: { name: IconName; focused: boolean }) {
  return (
    <View style={{
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: 4,
    }}>
      {focused && (
        <View style={{
          position: 'absolute',
          top: -4,
          width: 20,
          height: 3,
          borderRadius: 2,
          backgroundColor: COLORS.primary,
        }} />
      )}
      <Ionicons
        name={focused ? name : `${name}-outline` as keyof typeof Ionicons.glyphMap}
        size={22}
        color={focused ? COLORS.primary : COLORS.textMuted}
      />
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs screenOptions={{
      tabBarStyle: {
        backgroundColor: COLORS.tabBar,
        borderTopColor: COLORS.tabBarBorder,
        borderTopWidth: 0.5,
        height: Platform.OS === 'web' ? 64 : 84,
        paddingBottom: Platform.OS === 'web' ? 8 : 28,
        paddingTop: 8,
        elevation: 0,
        shadowOpacity: 0,
      },
      tabBarActiveTintColor: COLORS.primary,
      tabBarInactiveTintColor: COLORS.textMuted,
      tabBarLabelStyle: {
        fontSize: 11,
        fontWeight: '600',
        marginTop: 2,
      },
      headerStyle: { backgroundColor: COLORS.background },
      headerTintColor: COLORS.text,
      headerShadowVisible: false,
    }}>
      <Tabs.Screen name="index" options={{
        title: 'Bugun',
        tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} />,
      }} />
      <Tabs.Screen name="chat" options={{
        title: 'Koc',
        tabBarIcon: ({ focused }) => <TabIcon name="chatbubble-ellipses" focused={focused} />,
      }} />
      <Tabs.Screen name="plan" options={{
        title: 'Plan',
        tabBarIcon: ({ focused }) => <TabIcon name="calendar" focused={focused} />,
      }} />
      <Tabs.Screen name="progress" options={{
        title: 'Ilerleme',
        tabBarIcon: ({ focused }) => <TabIcon name="trending-up" focused={focused} />,
      }} />
      <Tabs.Screen name="profile" options={{
        title: 'Profil',
        tabBarIcon: ({ focused }) => <TabIcon name="person" focused={focused} />,
      }} />
    </Tabs>
  );
}
