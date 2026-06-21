import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getMonthSummaries, type DaySummary } from '@/services/calendar.service';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const MONTH_NAMES = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const DAY_NAMES = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

export default function CalendarScreen() {
  const insets = useSafeAreaInsets();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [days, setDays] = useState<DaySummary[]>([]);
  const [selected, setSelected] = useState<DaySummary | null>(null);

  // FIX (audit Wave3): catch loader rejection so a network failure degrades to an empty month grid
  // instead of an unhandled promise rejection.
  useEffect(() => { getMonthSummaries(year, month).then(setDays).catch(() => setDays([])); }, [year, month]);

  const prevMonth = () => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };

  // Calculate first day offset (Monday = 0)
  const firstDay = new Date(year, month - 1, 1).getDay();
  const offset = firstDay === 0 ? 6 : firstDay - 1;

  // FIX (audit UI-PLN-04): build today's string from LOCAL components, not UTC.
  // now.toISOString() is UTC, but day.date is built from local calendar values
  // (calendar.service.ts). In UTC+3, local 00:00-03:00 the UTC date is still
  // yesterday, so the "today" ring landed on the wrong cell. Same fix as monthly.tsx #S13.
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const getScoreColor = (score: number | null) => {
    if (score === null) return COLORS.surfaceLight;
    if (score >= 70) return COLORS.success;
    if (score >= 40) return COLORS.warning;
    return COLORS.error;
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>

      {/* Month navigation */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg }}>
        <TouchableOpacity
          onPress={prevMonth}
          accessibilityRole="button"
          accessibilityLabel="Önceki ay"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={{ color: COLORS.primary, fontSize: FONT.xl }}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700' }}>{MONTH_NAMES[month - 1]} {year}</Text>
        <TouchableOpacity
          onPress={nextMonth}
          accessibilityRole="button"
          accessibilityLabel="Sonraki ay"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={{ color: COLORS.primary, fontSize: FONT.xl }}>{'>'}</Text>
        </TouchableOpacity>
      </View>

      {/* Day headers */}
      <View style={{ flexDirection: 'row', marginBottom: SPACING.xs }}>
        {DAY_NAMES.map(d => (
          <View key={d} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{d}</Text>
          </View>
        ))}
      </View>

      {/* Calendar grid */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {/* Empty cells for offset */}
        {Array.from({ length: offset }).map((_, i) => (
          <View key={`empty-${i}`} style={{ width: '14.28%', aspectRatio: 1 }} />
        ))}

        {days.map(day => {
          const dayNum = new Date(day.date).getDate();
          const isToday = day.date === todayStr; // FIX (audit UI-PLN-04): compare against local-built todayStr
          const isSelected = selected?.date === day.date;

          return (
            <TouchableOpacity key={day.date} onPress={() => setSelected(day)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${dayNum} ${MONTH_NAMES[month - 1]}${isToday ? ', bugün' : ''}${day.hasData && day.compliance_score !== null ? `, uyum ${day.compliance_score}/100` : day.hasData ? '' : ', veri yok'}`}
              style={{ width: '14.28%', aspectRatio: 1, justifyContent: 'center', alignItems: 'center' }}>
              <View style={{
                width: 36, height: 36, borderRadius: 18,
                backgroundColor: isSelected ? COLORS.primary : day.hasData ? getScoreColor(day.compliance_score) + '30' : 'transparent',
                borderWidth: isToday ? 2 : 0, borderColor: COLORS.primary,
                justifyContent: 'center', alignItems: 'center',
              }}>
                <Text style={{ color: isSelected ? '#fff' : day.hasData ? COLORS.text : COLORS.textMuted, fontSize: FONT.sm, fontWeight: isToday ? '700' : '400' }}>{dayNum}</Text>
              </View>
              {/* Dot indicator */}
              {day.hasData && !isSelected && (
                <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: getScoreColor(day.compliance_score), marginTop: 2 }} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Color legend */}
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: SPACING.md, marginTop: SPACING.md }}
        accessibilityLabel="Renk açıklaması: yeşil iyi, turuncu orta, kırmızı düşük uyum, boş hücre veri yok"
      >
        {[
          { color: COLORS.success, label: 'İyi' },
          { color: COLORS.warning, label: 'Orta' },
          { color: COLORS.error, label: 'Düşük' },
        ].map(item => (
          <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.xs }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: item.color }} />
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>{item.label}</Text>
          </View>
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.xs }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: COLORS.textMuted }} />
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>Veri yok</Text>
        </View>
      </View>

      {/* Selected day detail */}
      {selected && (
        <Card title={new Date(selected.date).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })} style={{ marginTop: SPACING.lg }}>
          {!selected.hasData ? (
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm }}>Bu gün için veri yok.</Text>
          ) : (
            <View style={{ gap: 4 }}>
              {selected.compliance_score !== null && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>Uyum</Text>
                  <Text style={{ color: getScoreColor(selected.compliance_score), fontSize: FONT.md, fontWeight: '700' }}>{selected.compliance_score}/100</Text>
                </View>
              )}
              {selected.calorie_actual !== null && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>Kalori</Text>
                  <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{selected.calorie_actual} kcal</Text>
                </View>
              )}
              {selected.weight_kg !== null && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>Kilo</Text>
                  <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{selected.weight_kg} kg</Text>
                </View>
              )}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>Öğün</Text>
                <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{selected.meal_count} kayıt</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>Antrenman</Text>
                <Text style={{ color: selected.workout_done ? COLORS.success : COLORS.textMuted, fontSize: FONT.md }}>{selected.workout_done ? 'Yapıldı' : 'Yapılmadı'}</Text>
              </View>
            </View>
          )}
        </Card>
      )}
    </ScrollView>
  );
}
