import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useTheme } from '@/lib/theme';
import { SPACING } from '@/lib/constants';

/**
 * Thin banner shown above content when the device is offline. Nothing renders
 * when online — safe to drop in anywhere near the top of a screen.
 */
export function OfflineBanner() {
  const { isOnline } = useNetworkStatus();
  const { colors } = useTheme();
  if (isOnline) return null;
  return (
    <View style={{
      paddingHorizontal: SPACING.xl,
      paddingVertical: SPACING.sm,
      backgroundColor: colors.error + '22',
      borderBottomWidth: 0.5,
      borderBottomColor: colors.error + '66',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    }}>
      <Ionicons name="cloud-offline-outline" size={14} color={colors.error} />
      <Text style={{ color: colors.error, fontSize: 12, flex: 1 }}>
        Internet yok. Mesaj gonderimi ve senkronizasyon bekletiliyor.
      </Text>
    </View>
  );
}
