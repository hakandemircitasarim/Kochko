/**
 * B4-ses (TUTARLILIK-11) — the "second personality" regression net.
 *
 * The chat prompt fires the coach for saying "Harika!" while the cron literals shipped
 * "Harika gidiyorsun!", a 🏆 and accent-less Turkish under the same name. These tests scan the
 * EDGE SOURCES' string literals for the cliché vocabulary and banned emoji, so the next frozen
 * literal that breaks the voice fails CI instead of shipping a second persona.
 *
 * Scope: server-side coach text only (the four user-facing functions + shared). voice.ts itself
 * (the definition) and test files are excluded; comment-only lines are skipped.
 */
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { BANNED_EMOJI, CLICHES, VOICE_RULES } from './voice.ts';

const ROOTS = ['ai-chat', 'ai-proactive', 'ai-report', 'ai-plan', 'shared'];

function* walk(dir: string): Generator<string> {
  for (const e of Deno.readDirSync(dir)) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory) yield* walk(p);
    else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) && !/voice\.ts$/.test(e.name)) yield p;
  }
}

function offendingLines(pred: (line: string) => string | null): string[] {
  const base = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const hits: string[] = [];
  for (const root of ROOTS) {
    for (const f of walk(`${base}${root}`)) {
      const lines = Deno.readTextFileSync(f).split('\n');
      lines.forEach((ln, i) => {
        const t = ln.trim();
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return; // comments aren't user-visible
        const m = pred(ln);
        if (m) hits.push(`${f.slice(base.length)}:${i + 1} → ${m} in: ${t.slice(0, 90)}`);
      });
    }
  }
  return hits;
}

Deno.test('no cliché from the YASAK list survives in any edge source line', () => {
  const hits = offendingLines((ln) => CLICHES.find((c) => ln.includes(c)) ?? null);
  assertEquals(hits, [], `cliché in edge source:\n${hits.join('\n')}`);
});

Deno.test('no banned emoji in any edge source line (coach text is text)', () => {
  const hits = offendingLines((ln) => BANNED_EMOJI.find((e) => ln.includes(e)) ?? null);
  assertEquals(hits, [], `emoji in edge source:\n${hits.join('\n')}`);
});

Deno.test('the rules text itself still bans the vocabulary it scans for', () => {
  // Guards the DATA↔PROSE sync: if someone trims the YASAK paragraph, the scan list above
  // silently stops meaning what the prompt says.
  for (const probe of ['Harika!', 'Tabii ki', 'Elbette', 'Sağlıklı bir tercih']) {
    assertEquals(VOICE_RULES.includes(probe), true, `VOICE_RULES no longer lists: ${probe}`);
  }
  assertEquals(VOICE_RULES.includes('Emoji kullanma'), true);
});
