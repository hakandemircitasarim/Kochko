/**
 * AchievementShowcase — Başarımlar ekranının gövdesi: Duolingo rozet vitrini.
 *
 *   1. Kahraman kart: Koçko (bir rozet bile varsa sevinir) + kısa teşvik + koleksiyon
 *      ilerlemesi (ProgressBar). Sayı ikinci planda ("az sayı, çok teşvik").
 *   2. KAZANDIKLARIN: canlı, gövdeli madalyon + verideki başlık/açıklama/tarih + Paylaş.
 *   3. SIRADAKİLER: katalogda olup henüz kazanılmamış rozetler — gri silüet + "nasıl
 *      kazanılır" ipucu. Eskiden kazanılmamış hiçbir şey görünmüyordu; vitrinin amacı
 *      bir sonraki hedefi göstermek.
 *
 * Ekran (app/settings/achievements.tsx) veri yükleme/hata/iskeleti tutar; bu bileşen
 * yalnız sunum — örnek veriyle laboratuvarda da çizilebilsin diye ayrı.
 */
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Achievement } from '@/services/achievements.service';
import { Button } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Reveal } from '@/components/ui/Reveal';
import { KochkoMascot } from '@/components/mascot/KochkoMascot';
import { SectionHeader } from '@/components/settings/SectionHeader';
import { BadgeMedal, BADGE_CATALOG, badgeDef } from '@/components/profile/BadgeMedal';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE, mix } from '@/lib/design';

interface Props {
  items: Achievement[];
  onShare: (a: Achievement) => void;
}

export function AchievementShowcase({ items, onShare }: Props) {
  const { colors, isDark } = useTheme();
  const edge = isDark ? colors.border : colors.progressTrack;
  const earnedTypes = new Set(items.map(a => a.achievement_type));
  const earnedInCatalog = BADGE_CATALOG.filter(b => earnedTypes.has(b.type)).length;
  const locked = BADGE_CATALOG.filter(b => !earnedTypes.has(b.type));
  const total = BADGE_CATALOG.length;

  const headline = items.length === 0
    ? 'İlk rozetin çok yakın!'
    : earnedInCatalog >= total ? 'Hepsini topladın!' : 'Rozet avın sürüyor!';
  const sub = items.length === 0
    ? 'Kayıt girdikçe, kilo ve antrenman hedeflerine yaklaştıkça rozetler açılır.'
    : locked.length > 0 ? `Sıradaki: ${locked[0].title} — ${locked[0].hint.toLocaleLowerCase('tr-TR')}.` : 'Koçun seninle gurur duyuyor.';

  // Kahraman kartın pastel yüzü (opak): marka menekşesi zeminle karıştırıldı.
  const heroFace = mix(colors.primary, colors.background, isDark ? 0.2 : 0.1);
  const heroShelf = mix(colors.primary, colors.background, isDark ? 0.42 : 0.3);

  return (
    <View>
      <Reveal>
        <View style={{ paddingBottom: 4, marginBottom: SPACING.md }}>
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 4, bottom: 0, borderRadius: RADIUS.lg, backgroundColor: heroShelf }} />
          <View style={{ backgroundColor: heroFace, borderRadius: RADIUS.lg, padding: SPACING.lg, flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
            <KochkoMascot size={76} mood={items.length > 0 ? 'cheer' : 'happy'} />
            <View style={{ flex: 1 }}>
              <Text accessibilityRole="header" style={{ ...TYPE.title3, color: colors.text }}>{headline}</Text>
              <Text style={{ ...TYPE.callout, color: colors.textSecondary, marginTop: 2 }}>{sub}</Text>
              <View
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel={`${total} rozetten ${earnedInCatalog} tanesi kazanıldı`}
                accessibilityValue={{ min: 0, max: total, now: earnedInCatalog }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.md }}
              >
                <ProgressBar progress={earnedInCatalog / total} color={colors.primary} height={12} trackColor={colors.card} style={{ flex: 1 }} />
                <Text style={{ ...TYPE.caption, color: colors.textSecondary, fontWeight: '700' }}>{earnedInCatalog}/{total}</Text>
              </View>
            </View>
          </View>
        </View>
      </Reveal>

      {items.length > 0 && (
        <Reveal delay={80}>
          <SectionHeader title="Kazandıkların" />
          <View style={{ gap: SPACING.sm }}>
            {items.map(a => {
              const def = badgeDef(a.achievement_type);
              return (
                <View
                  key={a.id}
                  style={{ backgroundColor: colors.card, borderRadius: RADIUS.lg, borderWidth: 2, borderColor: edge, padding: SPACING.md, flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}
                >
                  <BadgeMedal icon={def?.icon ?? 'ribbon'} family={def?.family ?? 'pr'} earned size={60} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...TYPE.headline, color: colors.text, fontWeight: '700' }}>{a.title}</Text>
                    {a.description ? <Text style={{ ...TYPE.callout, color: colors.textSecondary, marginTop: 2 }}>{a.description}</Text> : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SPACING.sm, gap: SPACING.sm }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
                        <Ionicons name="calendar-outline" size={13} color={colors.textMuted} />
                        <Text style={{ ...TYPE.caption, color: colors.textMuted }}>
                          {new Date(a.achieved_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
                        </Text>
                      </View>
                      {/* D17: Paylaş — eylem butonu artık gövdeli Button (outline, küçük). */}
                      <Button
                        title="Paylaş"
                        size="sm"
                        variant="outline"
                        icon={<Ionicons name="share-social" size={14} color={colors.primary} />}
                        onPress={() => onShare(a)}
                        accessibilityLabel={`${a.title} başarımını paylaş`}
                      />
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </Reveal>
      )}

      {locked.length > 0 && (
        <Reveal delay={160}>
          <SectionHeader title={items.length > 0 ? 'Sıradakiler' : 'Kazanabileceğin rozetler'} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -SPACING.xs }}>
            {locked.map(b => (
              <View
                key={b.type}
                accessible
                accessibilityLabel={`${b.title}, kilitli rozet. ${b.hint}`}
                style={{ width: '33.33%', paddingHorizontal: SPACING.xs, marginBottom: SPACING.lg, alignItems: 'center' }}
              >
                <BadgeMedal icon={b.icon} family={b.family} earned={false} size={64} />
                <Text numberOfLines={1} style={{ ...TYPE.caption, fontWeight: '700', color: colors.textSecondary, marginTop: SPACING.xs, textAlign: 'center' }}>{b.title}</Text>
                <Text numberOfLines={2} style={{ ...TYPE.footnote, color: colors.textMuted, textAlign: 'center', marginTop: 1 }}>{b.hint}</Text>
              </View>
            ))}
          </View>
        </Reveal>
      )}
    </View>
  );
}
