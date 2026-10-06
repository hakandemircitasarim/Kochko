import { supabaseAdmin } from './supabase-admin.ts';
import { coachingNotesErasePatch } from './coaching-notes.ts';

/**
 * KVKK erase through chat — a TWO-STEP HOLD (AI_MIMARI_V2 §5.2 "ASK", §7.3 · Faz 0 #5).
 *
 * THE BUG: a substring regex ran BEFORE the model ever read the message. Any "sil/unut/sıfırla" plus
 * any "hesab/hafıza/veri" anywhere → the ai_summary row was DELETED, and with "hesab" in the text the
 * 30-day account deletion was SCHEDULED in the same turn. Live: "kalori hesabını sil" (= redo the
 * calorie calculation) queued the user's ACCOUNT for deletion. Deleting the row also deleted the
 * mig-101 tombstone column, so the nightly extractor rebuilt the "erased" memory.
 *
 * THE CONTRACT NOW (yapay zekâ anlar, kod denetler):
 *   1. The MODEL reads intent and emits `data_erase_request{scope}`. Code erases NOTHING: it stores a
 *      pending_writes hold (mig 106) and appends ONE fixed confirmation question to the reply.
 *   2. Only the NEXT user turn can confirm: if the model reads a clear yes it emits
 *      `data_erase_confirm`. Code executes only when an open hold exists, is unexpired, and exactly
 *      one coach reply (the question itself) sits between the hold and this turn. Otherwise it lapses.
 *   3. Memory erase = TOMBSTONE (fields cleared + derived_suppressed_at); the ai_summary row stays.
 *      Account erase = the Settings path's flags (privacy.service.requestAccountDeletion) + tombstone.
 * Code never reads the user's words here: it checks the model's enum, ownership and timing.
 */

export type EraseScope = 'memory' | 'account';

/** pending_writes.op — the registry name the v2 write registry will keep (§4.4). */
export const ERASE_OP = 'account_erase_request';

/** A confirmation is a reply to a question just asked; a "yes" long after it is not one. */
export const ERASE_HOLD_TTL_MIN = 30;
const ERASE_HOLD_TTL_MS = ERASE_HOLD_TTL_MIN * 60_000;

/** Same grace window as the Settings path and the day-30 cron (migration 023/068). */
const ACCOUNT_GRACE_DAYS = 30;

export interface EraseHold {
  id: string;
  scope: EraseScope;
  created_at: string;
  expires_at: string;
}

/**
 * The model's scope, validated — never a default. An unknown value is a question to the user, not a
 * guess (AI_MIMARI_V2 §5.3: "enum varsayılanına düşme" is banned). Case/space is lossless cleanup.
 */
export function parseEraseScope(v: unknown): EraseScope | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return s === 'memory' || s === 'account' ? s : null;
}

/** Why a hold cannot be confirmed THIS turn (null = it can). */
export type ConfirmBlock = 'none_pending' | 'expired' | 'same_turn' | 'not_next_turn';

/**
 * The "next turn only" rule as a pure function. `repliesSinceHold` = coach replies stored after the
 * hold was written. 0 → the question has not even been shown (a confirm in the SAME turn as the
 * request); 1 → this is the turn right after the question; >1 → the user already moved on.
 */
export function checkConfirmable(
  hold: Pick<EraseHold, 'expires_at'> | null,
  repliesSinceHold: number,
  nowMs: number,
): ConfirmBlock | null {
  if (!hold) return 'none_pending';
  const exp = Date.parse(hold.expires_at);
  if (!Number.isFinite(exp) || nowMs >= exp) return 'expired';
  if (repliesSinceHold <= 0) return 'same_turn';
  if (repliesSinceHold > 1) return 'not_next_turn';
  return null;
}

// ─── Code-owned lines (facts about what the code did — appended LAST to the reply) ───

const SETTINGS_PATH_TR = 'Ayarlar > Hesap ve Güvenlik';
// The ONLY withdrawal path is the gate shown when the app is opened again (app/index.tsx →
// reactivateAccount) — the settings screen can request a deletion but cannot cancel one.
const WITHDRAW_PATH_TR = 'uygulamayı yeniden açtığında çıkan ekrandan';

/** The ONE confirmation question of the request turn. Exactly one "?" (one-question budget). */
export function eraseQuestion(scope: EraseScope): string {
  if (scope === 'account') {
    return `Emin olmak için soruyorum: hesabını ve tüm verilerini (kayıtların, sohbetlerin, hakkında tuttuğum notlar) silme talebini başlatayım mı? Onaylarsan koç hafızamı hemen sıfırlarım; hesabın ve verilerin ${ACCOUNT_GRACE_DAYS} gün sonra kalıcı olarak silinir, o süre içinde ${WITHDRAW_PATH_TR} talebi geri çekebilirsin. Onaylıyorsan bir sonraki mesajında açıkça "evet" de; başka bir şey yazarsan hiçbir şey silmem.`;
  }
  return 'Emin olmak için soruyorum: hakkında tuttuğum koç hafızasını (notlar, çıkarımlar, alışkanlık özetleri) tamamen sıfırlayayım mı? Kayıtların ve hesabın yerinde kalır. Onaylıyorsan bir sonraki mesajında açıkça "evet" de; başka bir şey yazarsan hiçbir şey silmem.';
}

/** The model asked for an erase but gave no valid scope: ask, never pick one. */
export function eraseClarifyLine(): string {
  return 'Neyi silmemi istediğini netleştirelim: yalnızca hakkında tuttuğum koç hafızasını mı, yoksa hesabını ve tüm verilerini mi? Şu an hiçbir şey silmedim.';
}

export function eraseRequestFailedLine(): string {
  return `Silme talebini şu an kaydedemedim, hiçbir şey silinmedi. Birazdan yeniden isteyebilir ya da ${SETTINGS_PATH_TR} ekranını kullanabilirsin.`;
}

export function eraseDoneLine(r: { scope: EraseScope; memoryCleared: boolean }): string {
  if (r.scope === 'account') {
    const base = `Onayın üzerine hesap silme talebini başlattım${r.memoryCleared ? ' ve koç hafızamı sıfırladım' : ''}. Hesabın ve tüm verilerin ${ACCOUNT_GRACE_DAYS} gün sonra kalıcı olarak silinecek; fikrini değiştirirsen o güne kadar ${WITHDRAW_PATH_TR} talebi geri çekebilirsin.`;
    return r.memoryCleared ? base : `${base} Koç hafızamı şu an sıfırlayamadım; hesapla birlikte o da silinecek.`;
  }
  return 'Onayın üzerine hakkında tuttuğum koç hafızasını sıfırladım. Kayıtların ve hesabın yerinde; bundan sonra seni yeniden tanımaya başlayacağım.';
}

/** A confirm with no confirmable hold behind it: nothing ran, and the user is told how to proceed. */
export function eraseBlockedLine(): string {
  return `Bu onayı uygulayamadım, hiçbir şey silinmedi: bekleyen geçerli bir silme talebi yok (onayın, sorumdan hemen sonraki mesajda ve ${ERASE_HOLD_TTL_MIN} dakika içinde gelmesi gerekiyor). Hâlâ istiyorsan neyi silmemi istediğini yeniden yaz, tekrar onayını alayım.`;
}

export function eraseExecFailedLine(): string {
  return `Silme işlemini şu an tamamlayamadım, hiçbir şey silinmedi. Birazdan yeniden isteyebilir ya da ${SETTINGS_PATH_TR} ekranını kullanabilirsin.`;
}

/** The turn after the question passed without a confirm: the hold is gone — say so, once. */
export function eraseLapsedLine(): string {
  return 'Silme talebini uygulamadım, verilerin yerinde. Hâlâ istiyorsan yeniden söylemen yeterli.';
}

/**
 * Turn-context note for the model, present ONLY on the one turn that may confirm. The model has to
 * know a confirmation is pending to read "evet" as one; the code never reads it itself.
 * (ASCII Turkish, like the rest of the prompt it joins.)
 */
export function pendingEraseNote(scope: EraseScope): string {
  const what = scope === 'account'
    ? `hesabinin ve tum verilerinin silinmesini (${ACCOUNT_GRACE_DAYS} gun sonra kalici; koc hafizasi hemen sifirlanir)`
    : 'koc hafizasinin (hakkindaki notlar, cikarimlar, ozetler) sifirlanmasini';
  return `BEKLEYEN SILME ONAYI: Bir onceki cevabinin sonunda kullaniciya ${what} onaylayip onaylamadigini sordun. `
    + 'Bu mesaj o silmeyi ACIKCA onayliyorsa actions\'a {"type": "data_erase_confirm"} ekle. '
    + 'Tereddut, soru, "hayir", vazgecme ya da baska bir konu → EKLEME: talep bu turla duser ve hicbir sey silinmez. '
    + 'Kapsami degistiriyorsa (or. "sadece hafizani sil") confirm DEGIL, yeni bir data_erase_request gonder. '
    + 'Silmenin sonucunu sistem cevabinin sonuna kendisi yazar; sen "sildim" deme.';
}

/**
 * The memory tombstone. Mirrors src/services/privacy.service.ts `resetAISummary` (Settings → "Tüm
 * Hafızayı Sıfırla"); erase-hold.test.ts pins the key set against that file so the two paths cannot
 * drift. derived_suppressed_at is the mig-101 stamp that keeps the extractor from rebuilding it.
 */
export function memoryTombstonePatch(nowIso: string): Record<string, unknown> {
  return {
    general_summary: '',
    behavioral_patterns: [],
    ...coachingNotesErasePatch(),
    portion_calibration: {},
    strength_records: {},
    user_persona: null,
    nutrition_literacy: 'medium',
    learned_tone_preference: null,
    micro_nutrient_risks: [],
    alcohol_pattern: null,
    caffeine_sleep_notes: null,
    social_eating_notes: null,
    habit_progress: [],
    features_introduced: [],
    recovery_pattern: null,
    menstrual_notes: null,
    weekly_budget_pattern: null,
    supplement_notes: null,
    learned_meal_times: {},
    snacking_hours: [],
    seasonal_notes: null,
    tdee_notes: null,
    derived_suppressed_at: nowIso,
    updated_at: nowIso,
  };
}

// ─── DB side (service role) ───

async function loadOpenHold(userId: string): Promise<EraseHold | null> {
  const { data, error } = await supabaseAdmin.from('pending_writes')
    .select('id, payload, created_at, expires_at')
    .eq('user_id', userId).eq('op', ERASE_OP).eq('status', 'pending')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`pending_writes read failed: ${error.message}`);
  if (!data) return null;
  const scope = parseEraseScope((data.payload as { scope?: unknown } | null)?.scope);
  if (!scope) return null; // a hold without a valid scope can never be executed
  return { id: data.id as string, scope, created_at: data.created_at as string, expires_at: data.expires_at as string };
}

/** Coach replies stored after the hold. Only ai-chat writes assistant chat_messages rows, one per turn. */
async function repliesSince(userId: string, sinceIso: string): Promise<number> {
  const { count, error } = await supabaseAdmin.from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('role', 'assistant').gt('created_at', sinceIso);
  if (error) throw new Error(`chat_messages count failed: ${error.message}`);
  return count ?? 0;
}

/** Conditional close: only a still-pending hold moves. Returns whether THIS call moved it (claim). */
async function closeHold(id: string, status: 'confirmed' | 'discarded' | 'expired', note: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from('pending_writes')
    .update({ status, resolved_at: new Date().toISOString(), resolution_note: note })
    .eq('id', id).eq('status', 'pending').select('id');
  if (error) {
    console.error('[erase_hold] close failed:', error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/** Step 1 — store the hold. An earlier open hold is superseded (one open erase per user, mig 106). */
export async function createEraseHold(userId: string, scope: EraseScope, nowMs = Date.now()): Promise<{ ok: boolean; id?: string }> {
  try {
    await supabaseAdmin.from('pending_writes')
      .update({ status: 'discarded', resolved_at: new Date(nowMs).toISOString(), resolution_note: 'superseded' })
      .eq('user_id', userId).eq('op', ERASE_OP).eq('status', 'pending');
    const { data, error } = await supabaseAdmin.from('pending_writes').insert({
      user_id: userId,
      op: ERASE_OP,
      payload: { scope },
      status: 'pending',
      expires_at: new Date(nowMs + ERASE_HOLD_TTL_MS).toISOString(),
    }).select('id').maybeSingle();
    if (error || !data) {
      console.error('[erase_hold] create failed:', error?.message ?? 'no row');
      return { ok: false };
    }
    console.log('[erase_hold] hold created', { scope });
    return { ok: true, id: data.id as string };
  } catch (e) {
    console.error('[erase_hold] create threw:', (e as Error).message);
    return { ok: false };
  }
}

/**
 * Turn start: the hold THIS turn may confirm (so the model can be told about it), or null. A stale
 * hold (expired, never shown, or already answered by another turn) is closed here so no later "evet"
 * can reach it.
 */
export async function holdForThisTurn(userId: string, nowMs = Date.now()): Promise<EraseHold | null> {
  const hold = await loadOpenHold(userId);
  if (!hold) return null;
  const block = checkConfirmable(hold, await repliesSince(userId, hold.created_at), nowMs);
  if (block === null) return hold;
  await closeHold(hold.id, 'expired', block);
  return null;
}

/** Turn end: the presented hold was not confirmed this turn → it lapses. True when THIS call closed it. */
export function lapseEraseHold(holdId: string): Promise<boolean> {
  return closeHold(holdId, 'discarded', 'not_confirmed');
}

export interface EraseOutcome {
  ok: boolean;
  scope: EraseScope | null;
  /** Code-owned line for the reply; null when nothing should be said (premature same-turn confirm). */
  line: string | null;
  failureClass: string | null;
}

async function executeErase(
  userId: string, scope: EraseScope, holdId: string, nowMs: number,
): Promise<{ ok: boolean; memoryCleared: boolean; error?: string }> {
  const nowIso = new Date(nowMs).toISOString();
  if (scope === 'account') {
    // The SAME flags as the Settings path (privacy.service.requestAccountDeletion): the day-30 cron
    // reads deletion_requested_at; the re-login "Hesap silme talebi bekliyor" screen reads both.
    const { data, error } = await supabaseAdmin.from('profiles')
      .update({ deletion_requested_at: nowIso, deleted_at: nowIso, updated_at: nowIso })
      .eq('id', userId).select('id');
    if (error || !data?.length) return { ok: false, memoryCleared: false, error: error?.message ?? 'profile_not_updated' };
  }
  // TOMBSTONE, never a row delete: the row carries derived_suppressed_at (mig 101) — deleting it is
  // exactly how the "erased" memory came back overnight. Upsert so a user with no row still gets one.
  const { error: memErr } = await supabaseAdmin.from('ai_summary')
    .upsert({ user_id: userId, ...memoryTombstonePatch(nowIso) }, { onConflict: 'user_id' });
  if (memErr) console.error('[erase_hold] memory tombstone failed:', memErr.message);
  if (scope === 'memory' && memErr) return { ok: false, memoryCleared: false, error: memErr.message };

  // KVKK audit trail. Loud on failure but never a reason to un-do an erase the user confirmed.
  const scheduled = new Date(nowMs + ACCOUNT_GRACE_DAYS * 86_400_000).toISOString().split('T')[0];
  const { error: auditErr } = await supabaseAdmin.from('audit_logs').insert({
    user_id: userId,
    event_type: scope === 'account' ? 'account_delete_request' : 'ai_summary_delete',
    description: scope === 'account'
      ? 'KVKK: sohbetten hesap silme talebi (iki adımlı onay, 30 gün)'
      : 'KVKK: sohbetten koç hafızası sıfırlama (iki adımlı onay, tombstone)',
    metadata: {
      source: 'chat',
      pending_write_id: holdId,
      ...(scope === 'account' ? { scheduled_deletion_date: scheduled } : {}),
    },
  });
  if (auditErr) console.error('[erase_hold] audit insert failed:', auditErr.message);
  return { ok: true, memoryCleared: !memErr };
}

/**
 * Step 2 — the model read a clear yes. Validate the hold (exists, unexpired, next turn), CLAIM it
 * (pending → confirmed, so a concurrent retry cannot run it twice), then execute.
 */
export async function confirmEraseHold(userId: string, nowMs = Date.now()): Promise<EraseOutcome> {
  let hold: EraseHold | null = null;
  let replies = 0;
  try {
    hold = await loadOpenHold(userId);
    if (hold) replies = await repliesSince(userId, hold.created_at);
  } catch (e) {
    console.error('[erase_hold] confirm read failed:', (e as Error).message);
    return { ok: false, scope: null, line: eraseExecFailedLine(), failureClass: 'erase_read_failed' };
  }
  const block = checkConfirmable(hold, replies, nowMs);
  if (block === 'same_turn') {
    // The request was written THIS turn and the user has not seen the question yet. The model's
    // confirm is premature — ignore it; the hold stays open for the user's real answer.
    console.warn('[erase_hold] confirm in the same turn as the request — ignored');
    return { ok: false, scope: hold?.scope ?? null, line: null, failureClass: 'erase_same_turn' };
  }
  if (block !== null || !hold) {
    if (hold) await closeHold(hold.id, 'expired', block ?? 'none_pending');
    console.warn('[erase_hold] confirm blocked', { block });
    return { ok: false, scope: hold?.scope ?? null, line: eraseBlockedLine(), failureClass: `erase_${block ?? 'none_pending'}` };
  }
  if (!(await closeHold(hold.id, 'confirmed', 'confirmed_next_turn'))) {
    // Another attempt claimed (or closed) it first — that attempt owns the outcome.
    return { ok: false, scope: hold.scope, line: eraseBlockedLine(), failureClass: 'erase_already_resolved' };
  }
  const r = await executeErase(userId, hold.scope, hold.id, nowMs)
    .catch((e): { ok: boolean; memoryCleared: boolean; error?: string } => ({ ok: false, memoryCleared: false, error: (e as Error).message }));
  if (!r.ok) {
    console.error('[erase_hold] execute failed:', r.error);
    await supabaseAdmin.from('pending_writes')
      .update({ status: 'failed', resolution_note: (r.error ?? 'failed').slice(0, 200) })
      .eq('id', hold.id).then(() => {}, () => {});
    return { ok: false, scope: hold.scope, line: eraseExecFailedLine(), failureClass: 'erase_failed' };
  }
  console.log('[erase_hold] executed', { scope: hold.scope, memoryCleared: r.memoryCleared });
  return { ok: true, scope: hold.scope, line: eraseDoneLine({ scope: hold.scope, memoryCleared: r.memoryCleared }), failureClass: null };
}
