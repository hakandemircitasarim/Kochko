/**
 * retrieval-planner.test.ts — "no turn ever meets a smaller person".
 *
 * The 2026-08-01 diagnosis: this planner used to resize the coach's MEMORY per message. Two
 * consecutive turns saw profile full<->minimal and person-summary full<->absent, so the user faced
 * a different assistant every message. The floor fixed it; these tests keep it fixed.
 *
 * The identity layers are now ASSIGNED rather than raised, so the guarantee is structural. The
 * sweep below is what proves it stayed structural.
 */
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { analyzeMessage, getRetrievalPlan } from './retrieval-planner.ts';
import type { TaskMode } from '../ai-chat/task-modes.ts';

const MODES: TaskMode[] = [
  'register', 'plan', 'plan_diet', 'plan_workout', 'daily_log', 'coaching', 'analyst',
  'qa', 'recipe', 'eating_out', 'mvd', 'plateau', 'simulation', 'recovery',
  'onboarding', 'periodic',
];

const MESSAGES = [
  'merhaba', 'selam', 'hey', 'gunaydin',
  '2 yumurta yedim', 'bugun 5 km kostum', '81 kilo oldum', '8 saat uyudum',
  'sirtim agriyor antrenmana gideyim mi', 'neden kilo vermiyorum', 'bu hafta nasil gecti',
  'aksama ne yesem', 'protein nedir', 'benim proteinim yeterli mi', 'motivasyonum kalmadi',
  'dun cok yedim bozdum', 'plan olustur', 'restoranda ne yiyeyim', 'dizim agriyor',
  'kac kalori yakmisim', 'yarin ne yapmaliyim', 'son bir ayda ne degisti',
];

function sweep(): { mode: TaskMode; msg: string; plan: ReturnType<typeof getRetrievalPlan>; subtype: string }[] {
  const out = [];
  for (const mode of MODES) {
    for (const msg of MESSAGES) {
      const a = analyzeMessage(msg, mode);
      out.push({ mode, msg, plan: getRetrievalPlan(a), subtype: a.subtype });
    }
  }
  return out;
}

Deno.test('THE invariant: identity layers never vary — not once, across every turn the app can make', () => {
  const all = sweep();
  assert(all.length >= 300, `sweep too small to mean anything: ${all.length}`);

  for (const { mode, msg, plan } of all) {
    const where = `${mode} / "${msg}"`;
    assertEquals(plan.layer1, 'full', `${where}: profile was shrunk`);
    assertEquals(plan.layer2, 'full', `${where}: person summary was shrunk`);
    assertEquals(
      [...plan.layer1Focus].sort().join(','),
      'demographics,health,nutrition,training',
      `${where}: profile focus was narrowed`,
    );
    assertEquals(
      [...plan.layer2Focus].sort().join(','),
      'habits,patterns,persona,preferences,strength',
      `${where}: learned-insight focus was narrowed`,
    );
  }
});

Deno.test('even a bare greeting knows who it is greeting', () => {
  // The pre-fix greeting fast path threw away the person summary — the coach said hello to a
  // stranger. It may still skip DAY DATA; it may never skip identity.
  //
  // NB the fast path lives in the 'coaching' analyzer. In 'daily_log' — the app's highest-frequency
  // mode — even a bare "merhaba" gets the full conversational plan, which is the safer default and
  // is asserted by the floor sweep above.
  for (const msg of ['merhaba', 'selam', 'hey', 'gunaydin']) {
    const a = analyzeMessage(msg, 'coaching');
    assertEquals(a.subtype, 'pure_greeting', `"${msg}" should be a bare greeting`);
    const p = getRetrievalPlan(a);
    assertEquals(p.layer1, 'full');
    assertEquals(p.layer2, 'full');
    // …but it stays cheap on the parts that cost real reads.
    assertEquals(p.layer3.daysBack, 0);
    assert(p.layer4MaxMessages <= 10, 'greeting should not drag 30 messages');
  }
});

Deno.test('a message with real content is never treated as a greeting', () => {
  // "selam, dun cok yedim" must not take the fast path — the content signal wins.
  for (const msg of ['selam dun cok yedim', 'merhaba kilo vermiyorum', 'gunaydin sirtim agriyor']) {
    const a = analyzeMessage(msg, 'coaching');
    assert(a.subtype !== 'pure_greeting', `"${msg}" took the greeting fast path`);
  }
});

Deno.test('every real conversation turn sees at least a week of data and 30 messages', () => {
  for (const { mode, msg, plan, subtype } of sweep()) {
    if (subtype === 'pure_greeting') continue;
    const where = `${mode} / "${msg}"`;
    assert(plan.layer3.daysBack >= 7, `${where}: only ${plan.layer3.daysBack} days of data`);
    assert(plan.layer4MaxMessages >= 30, `${where}: only ${plan.layer4MaxMessages} messages of history`);
    assert(plan.layer3.detailLevel !== 'reference', `${where}: day data reduced to exists/not-exists`);
    for (const needed of ['meals', 'workouts', 'metrics']) {
      assert(plan.layer3.scope.includes(needed as never), `${where}: missing ${needed}`);
    }
  }
});

Deno.test('a turn may still enrich beyond the floor — the floor is a minimum, not a cap', () => {
  // Plateau diagnosis needs a month of scale data; flattening everything to exactly the floor
  // would be its own bug, so prove the ceiling is still reachable.
  const plateau = getRetrievalPlan(analyzeMessage('plato', 'analyst'));
  assert(plateau.layer3.daysBack >= 30, `plateau got only ${plateau.layer3.daysBack} days`);

  // General analysis sits between the floor and plateau — proof the ladder has real rungs.
  const general = getRetrievalPlan(analyzeMessage('son bir ayda ne degisti', 'analyst'));
  assert(general.layer3.daysBack >= 14, `general analysis got only ${general.layer3.daysBack} days`);

  const periodic = getRetrievalPlan(analyzeMessage('adet donemim basladi', 'periodic'));
  assert(periodic.layer3.scope.includes('labAlerts'), 'periodic lost its lab-alert scope');
});
