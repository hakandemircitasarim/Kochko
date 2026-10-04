import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { detectEDRisk } from './guardrails.ts';

// JS \b only knows ASCII letters: the old /\bama\b/ also matched inside "amaç"/"aşama", cutting
// the clause early so a real refusal ("...amaçlı kullanmıyorum") stopped negating the trigger.
Deno.test('ED clause split: "ama" inside a Turkish word does not break the clause', () => {
  const r = detectEDRisk('laksatif amaçlı kullanmıyorum');
  assertEquals(r.isRisk && r.severity === 'high', false);
});
