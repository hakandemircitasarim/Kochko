import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { getMonthSummaries, type DaySummary } from '@/services/calendar.service';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const MONTH_NAMES = ['Ocak', 'Subat', 'Mart', 'Nisan', 'Mayis', 'Haziran', 'Temmuz', 'Agustos', 'Eylul', 'Ekim', 'Kasim', 'Aralik'];
const DAY_NAMES = ['Pt', 'Sa', 'Ca', 'Pe', 'Cu', 'Ct', 'Pa'];

export default function CalendarScreen() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [days, setDays] = useState<DaySummary[]>([]);
  const [selected, setSelected] = useState<DaySummary | null>(null);

  useEffect(() => { getMonthSummaries(year, month).then(setDays); }, [year, month]);

  const prevMonth = () => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };

  // Calculate first day offset (Monday = 0)
  const firstDay = new Date(year, month - 1, 1).getDay();
  const offset = firstDay === 0 ? 6 : firstDay - 1;

  const getScoreColor = (score: number | null) => {
    if (score === null) return COLORS.surfaceLight;
    if (score >= 70) return COLORS.success;
    if (score >= 40) return COLORS.warning;
    return COLORS.error;
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Takvim</Text>

      {/* Month navigation */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg }}>
        <TouchableOpacity onPress={prevMonth}><Text style={{ color: COLORS.primary, fontSize: FONT.xl }}>{'<'}</Text></TouchableOpacity>
        <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700' }}>{MONTH_NAMES[month - 1]} {year}</Text>
        <TouchableOpacity onPress={nextMonth}><Text style={{ color: COLORS.primary, fontSize: FONT.xl }}>{'>'}</Text></TouchableOpacity>
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
          const isToday = day.date === now.toISOString().split('T')[0];
          const isSelected = selected?.date === day.date;

          return (
            <TouchableOpacity key={day.date} onPress={() => setSelected(day)}
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

      {/* Selected day detail */}
      {selected && (
        <Card title={new Date(selected.date).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })} style={{ marginTop: SPACING.lg }}>
          {!selected.hasData ? (
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm }}>Bu gun icin veri yok.</Text>
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
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>Ogun</Text>
                <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{selected.meal_count} kayit</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>Antrenman</Text>
                <Text style={{ color: selected.workout_done ? COLORS.success : COLORS.textMuted, fontSize: FONT.md }}>{selected.workout_done ? 'Yapildi' : 'Yapilmadi'}</Text>
              </View>
            </View>
          )}
        </Card>
      )}
    </ScrollView>
  );
}
