import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { detectTaskMode } from './task-modes.ts';

// final2#9: "bugün çok fazla yedim" has a word between "çok" and "yedim", missed the recovery
// regex and ran as REGISTER — no weekly-budget perspective, no recovery_plan action.
Deno.test('final2#9: an intensified overeating report routes to recovery', () => {
  assertEquals(detectTaskMode('bugün çok fazla yedim ya, az önce 3 dilim pasta yedim', false), 'recovery');
  assertEquals(detectTaskMode('bugun cok fazla yedim', false), 'recovery');
  assertEquals(detectTaskMode('akşam biraz fazla yedim galiba', false), 'recovery');
  assertEquals(detectTaskMode('bu akşam fazla kaçırdım', false), 'recovery');
  assertEquals(detectTaskMode('dün aşırı yedim', false), 'recovery');
  // unchanged
  assertEquals(detectTaskMode('çok yedim bugün', false), 'recovery');
});

Deno.test('final2#9: a skipped meal and a plain meal report keep their routes', () => {
  assertEquals(detectTaskMode('öğle yemeğini kaçırdım', false), 'register');
  assertEquals(detectTaskMode('az önce 3 dilim pasta yedim', false), 'register');
  assertEquals(detectTaskMode('bugün yeterince protein yedim mi sence', false) !== 'recovery', true);
});
