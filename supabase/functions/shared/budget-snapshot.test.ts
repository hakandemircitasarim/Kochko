import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { budgetWeekWindow, intakeTargetNote, renderBudgetSnapshot, simulationNumbers, type BudgetSnapshot } from './service-contexts.ts';

// 2026-10-04 is a Sunday.
Deno.test('diff#4: budgetWeekWindow — today, a later day this week, a day in the next week', () => {
  assertEquals(budgetWeekWindow('2026-10-04', '2026-10-04'), { weekStart: '2026-09-28', pastDays: 6, laterWeek: false });
  assertEquals(budgetWeekWindow('2026-10-01', '2026-10-03'), { weekStart: '2026-09-28', pastDays: 3, laterWeek: false });
  assertEquals(budgetWeekWindow('2026-10-04', '2026-10-05'), { weekStart: '2026-10-05', pastDays: 0, laterWeek: true });
});

const todaySnap: BudgetSnapshot = {
  todayConsumed: 1800, dailyTarget: 2000, dailyRemaining: 200,
  weeklyBudget: null, weeklyConsumed: 9000, weeklyRemaining: null, daysLeftInWeek: 1, unloggedPastDays: 0,
};

Deno.test('diff#4: today what-ifs keep the exact old card wording', () => {
  assertEquals(simulationNumbers(todaySnap, 570), { remaining: -370, weeklyImpact: 'Haftalık bütçe tanımlı değil; bugünkü hedefi 370 kcal aşar.' });
  const wk = { ...todaySnap, weeklyBudget: 14000, weeklyRemaining: 5000 };
  assertEquals(simulationNumbers(wk, 570).weeklyImpact, 'Haftalık bütçende 4.430 kcal kalır (haftanın kalan 1 günü için).');
  assert(renderBudgetSnapshot(todaySnap).includes('Bugun yenilen: 1800 kcal'));
});

Deno.test('diff#4: tomorrow (a new week) is measured against tomorrow\'s full day and its own week', () => {
  // Sunday, 1800 of 2000 eaten today; tomorrow's pizza ~570 kcal.
  const tomorrow: BudgetSnapshot = {
    todayConsumed: 0, dailyTarget: 2000, dailyRemaining: 2000,
    weeklyBudget: 14000, weeklyConsumed: 0, weeklyRemaining: 14000, daysLeftInWeek: 7, unloggedPastDays: 0,
    dayLabel: 'yarın', day: '2026-10-05', laterWeek: true,
  };
  const n = simulationNumbers(tomorrow, 570);
  assertEquals(n.remaining, 1430);
  assertEquals(n.weeklyImpact, 'Yarın yeni haftaya düşüyor; o haftanın bütçesinde 13.430 kcal kalır.');
  const prompt = renderBudgetSnapshot(tomorrow);
  assert(prompt.includes('SORU BUGUN HAKKINDA DEGIL — yarın (2026-10-05)'), prompt);
  assert(prompt.includes('YENI haftaya'), prompt);
  assert(!prompt.includes('Bugun yenilen:'), prompt); // today's eaten line is replaced, not added
});

Deno.test('diff#4: a future day with no weekly budget never says "bugün"', () => {
  const sat: BudgetSnapshot = {
    todayConsumed: 0, dailyTarget: 2100, dailyRemaining: 2100,
    weeklyBudget: null, weeklyConsumed: 3000, weeklyRemaining: null, daysLeftInWeek: 5, unloggedPastDays: 0,
    dayLabel: 'cumartesi', day: '2026-10-10', laterWeek: false,
  };
  assertEquals(simulationNumbers(sat, 2500).weeklyImpact, 'Haftalık bütçe tanımlı değil; cumartesi için günlük hedefi 400 kcal aşar.');
  assertEquals(simulationNumbers(sat, 600).weeklyImpact, 'Haftalık bütçe tanımlı değil; cumartesi için 1.500 kcal kalır.');
});

Deno.test('final2#16: intake verdict follows the PLAN band and the plan protein', () => {
  // The live case: 2001 kcal / 116 g against plan 2003-2295 kcal and 135 g.
  assertEquals(intakeTargetNote(2001, 116, { min: 2003, max: 2295 }, 135, 2149),
    ' (plan aralığı 2003-2295 kcal, alt sınıra 2 kcal var | protein hedefi 135g, kalan 19g)');
  assertEquals(intakeTargetNote(2100, 140, { min: 2003, max: 2295 }, 135, 2149),
    ' (plan aralığı 2003-2295 kcal, aralığın içinde | protein hedefi 135g, ulaşıldı)');
  assertEquals(intakeTargetNote(2400, 90, { min: 2003, max: 2295 }, null, 2149), ' (plan aralığı 2003-2295 kcal, üst sınırı 105 kcal aştı)');
});

Deno.test('final2#16: no plan row → the old profile-midpoint wording', () => {
  assertEquals(intakeTargetNote(2001, 116, null, null, 2059), ' (hedef ~2059, kalan ~58)');
  assertEquals(intakeTargetNote(2001, 116, null, null, null), '');
});
