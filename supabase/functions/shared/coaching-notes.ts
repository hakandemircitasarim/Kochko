import { supabaseAdmin } from './supabase-admin.ts';

/**
 * THE ONE WRITER for ai_summary.coaching_notes (plan v2, F2 · A11).
 *
 * THE BUG: `updateLayer2(userId, { coaching_notes: '...' })` goes through the ai_summary_merge RPC,
 * which COALESCEs — i.e. REPLACES the column. Two call sites used it with a single fresh line:
 * `plateau_strategy_apply` and `maintenance_start`. So the moment a user accepted a plateau
 * strategy or moved to maintenance, every dated coaching observation accumulated over months was
 * deleted in one write. Irreversible, silent, and it hits precisely the long-tenured users whose
 * notes are worth the most.
 *
 * THE RULE: coaching notes are an APPEND-ONLY dated log. Nothing may replace the column; a caller
 * hands over one line and this module prefixes it with the date and the source and appends it.
 * Trimming happens from the FRONT (oldest first) so the newest observations always survive.
 */

const MAX_LINES = 40;
const MAX_CHARS = 4000;

export type NoteSource =
  | 'chat' | 'plateau' | 'maintenance' | 'mini_cut' | 'report' | 'extractor' | 'plan' | 'system';

/** Keep the log bounded without ever dropping the newest entries. */
export function trimNotes(notes: string): string {
  let lines = notes.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
  if (lines.length > MAX_LINES) lines = lines.slice(lines.length - MAX_LINES);
  let out = lines.join('\n');
  while (out.length > MAX_CHARS && lines.length > 1) {
    lines = lines.slice(1);
    out = lines.join('\n');
  }
  return out;
}

/** Compose the dated line. Exported for tests so the format cannot drift silently. */
export function formatNote(dateStr: string, source: NoteSource, text: string): string {
  return `[${dateStr} · ${source}] ${text.trim()}`;
}

/**
 * Append ONE dated observation. Read-modify-write on purpose: the merge RPC replaces, and there is
 * no server-side append primitive for a text column. The race window is a single user's own turns,
 * and losing a duplicate observation is a far smaller harm than the wholesale wipe this replaces.
 */
export async function appendCoachingNote(
  userId: string,
  source: NoteSource,
  text: string,
  dateStr?: string,
): Promise<{ ok: boolean }> {
  const line = formatNote(dateStr ?? new Date().toISOString().split('T')[0], source, text);
  try {
    const { data: existing } = await supabaseAdmin
      .from('ai_summary').select('coaching_notes').eq('user_id', userId).maybeSingle();
    const current = (existing?.coaching_notes as string | null) ?? '';
    // Idempotence: the same line twice in one day (a retried turn) must not double-write.
    if (current.includes(line)) return { ok: true };
    const next = trimNotes(`${current}\n${line}`);
    const { error } = await supabaseAdmin
      .from('ai_summary').update({ coaching_notes: next }).eq('user_id', userId);
    if (error) {
      console.error('[coaching-notes] append failed:', error.message);
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error('[coaching-notes] append threw:', (e as Error).message);
    return { ok: false };
  }
}
