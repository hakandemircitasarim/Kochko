import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { gateUserText, type UserSafetySnapshot } from './output-gate.ts';

const withPeanut: UserSafetySnapshot = { allergens: [{ name: 'fıstık', severity: 'severe' }], injuredParts: [], loaded: true };
const clean: UserSafetySnapshot = { allergens: [], injuredParts: [], loaded: true };
const unreadable: UserSafetySnapshot = { allergens: [], injuredParts: [], loaded: false };

Deno.test('A2: a severe allergen in a PUSH is held, not warned about', () => {
  const v = gateUserText('Bugün fıstık ezmeli tost dene, proteini yüksek.', withPeanut, 'push');
  assertEquals(v.ok, false);
  assertEquals(v.replacement, null, 'a lock screen has no room for a safety conversation');
  assertEquals(v.flags.includes('allergen_blocked'), true);
});

Deno.test('A2: a clean message passes on every surface', () => {
  for (const s of ['push', 'card', 'report', 'chat'] as const) {
    assertEquals(gateUserText('Bugün su hedefini tutturdun, güzel gidiyor.', withPeanut, s).ok, true, s);
  }
});

Deno.test('A2: an UNREADABLE snapshot is not the same fact as "no allergens"', () => {
  // The whole point: an empty allergen list from a failed read must never be treated as safe.
  assertEquals(gateUserText('Fıstık ezmeli tost dene', unreadable, 'push').ok, false);
  assertEquals(gateUserText('Fıstık ezmeli tost dene', clean, 'push').ok, true);
  // Chat still proceeds — it has its own scan and the user can object.
  assertEquals(gateUserText('Fıstık ezmeli tost dene', unreadable, 'chat').ok, true);
});
