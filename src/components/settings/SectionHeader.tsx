/**
 * Section Header - reusable section title for settings screens.
 */
import { Text } from 'react-native';
import { SPACING, FONT } from '@/lib/constants';
import { useTheme } from '@/lib/theme';

interface Props {
  title: string;
}

export function SectionHeader({ title }: Props) {
  const { colors } = useTheme();
  return (
    <Text
      accessibilityRole="header" // FIX (audit UI-PR-02): mark section title as header so screen-reader rotor/TalkBack can jump between sections, matching ScreenHeader
      style={{
      color: colors.textSecondary,
      fontSize: FONT.xs,
      fontWeight: '600',
      marginTop: SPACING.lg,
      marginBottom: SPACING.sm,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    }}>
      {title}
    </Text>
  );
}
