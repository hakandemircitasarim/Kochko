/**
 * Quick Supplement Add Component
 * Shows common supplements as tappable pills for fast logging.
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { logSupplement } from '@/services/supplements.service';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const QUICK_ITEMS = [
  { name: 'Protein', amount: '1 olcu', icon: 'P' },
  { name: 'Kreatin', amount: '5g', icon: 'K' },
  { name: 'Omega-3', amount: '1 kapsul', icon: 'O' },
  { name: 'Vitamin D', amount: '1 tablet', icon: 'D' },
  { name: 'Multi', amount: '1 tablet', icon: 'M' },
];

interface Props {
  onLogged?: () => void;
}

export function SupplementQuickAdd({ onLogged }: Props) {
  const handleAdd = async (name: string, amount: string) => {
    await logSupplement(name, amount);
    onLogged?.();
  };

  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '500', marginBottom: SPACING.sm }}>Supplement</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {QUICK_ITEMS.map((item, i) => (
          <TouchableOpacity key={i} onPress={() => handleAdd(item.name, item.amount)}
            style={{ alignItems: 'center', flex: 1 }}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surfaceLight, justifyContent: 'center', alignItems: 'center', marginBottom: 4 }}>
              <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '700' }}>{item.icon}</Text>
            </View>
            <Text style={{ color: COLORS.textMuted, fontSize: 9 }}>{item.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
