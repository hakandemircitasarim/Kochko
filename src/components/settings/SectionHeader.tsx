/**
 * Section Header - reusable section title for settings screens.
 */
import { Text } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface Props {
  title: string;
}

export function SectionHeader({ title }: Props) {
  return (
    <Text style={{
      color: COLORS.textSecondary,
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
