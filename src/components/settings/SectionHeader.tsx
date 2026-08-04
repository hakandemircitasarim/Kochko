/**
 * Section Header - reusable section title for settings screens.
 */
import { Text } from 'react-native';
import { SPACING } from '@/lib/constants';
import { TYPE } from '@/lib/design';
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
        // Was an 11px/600/0.5 hand-tuned eyebrow — a fourth copy of what TYPE.overline is.
        ...TYPE.overline,
        color: colors.textSecondary,
        marginTop: SPACING.lg,
        marginBottom: SPACING.sm,
      }}
    >
      {/* FIX: textTransform:'uppercase' uppercases locale-blind, so Turkish dotted i became a
          dotless I — measured on device: "E-posta Değiştir" rendered as "E-POSTA DEĞIŞTIR"
          instead of "E-POSTA DEĞİŞTİR". Same bug class already fixed in settings/index.tsx
          (SectionTitle) and settings/coach-memory.tsx (CategoryTitle); this is the shared one,
          so it was wrong on every screen that uses it. */}
      {title.toLocaleUpperCase('tr-TR')}
    </Text>
  );
}
