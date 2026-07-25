/**
 * memory-mirror.ts — the GLASS-BOX (target-architecture L7 transparency, step 15 slice).
 *
 * The user asked to SEE what is "in the coach's active filter" and be able to correct it. This
 * builds a DETERMINISTIC, exact snapshot of everything the coach actively believes about the user —
 * goal, safety constraints, tastes, routine, learned patterns — each tagged with WHERE the belief
 * came from (provenance). It is rendered verbatim (never paraphrased by the LLM) so the user sees
 * the real stored facts, and it ends with an explicit invitation to correct anything wrong; the
 * existing chat correction handlers (allergy-retraction, like-reversal, dislike, profile_update…)
 * are the write path, so mirror + correction together close the loop the user described.
 */
import { supabaseAdmin } from './supabase-admin.ts';
import { getBeliefHistory } from './belief-log.ts';

/** Does the message ask the coach to reflect what it knows about the user? */
export function isMemoryMirrorIntent(message: string): boolean {
  const m = (message ?? '').toLocaleLowerCase('tr').trim();
  if (m.length < 6) return false;
  // "beni nasıl tanıyorsun", "hakkımda ne biliyorsun", "benimle ilgili neler biliyorsun",
  // "beni tanıt", "hakkımda neler kayıtlı", "aktif süzgeçte ne var", "hafızanda ne var",
  // "profilimde ne var", "beni ne kadar tanıyorsun".
  return (
    /(beni|benimle ilgili|hakkımda|hakkimda|hakkında değil).{0,20}(nasıl|nasil|ne kadar|neler|ne).{0,12}(tanı|tani|bil|biliyor|kayıt|kayit)/.test(m) ||
    /(hakkımda|hakkimda|benimle ilgili|profilimde|hafızanda|hafizanda|aktif süzge|aktif suzge).{0,20}(ne|neler|nedir).{0,10}(var|biliyor|kayıt|kayit|bil)/.test(m) ||
    /beni (nasıl|nasil) (görüyor|goruyor|tanı|tani)/.test(m) ||
    /beni tanıt|beni tanit|kendimi (senden|sana)|neler biliyorsun benim/.test(m) ||
    /(hafızanda|hafizanda|aklında|aklinda) (ne|neler) var/.test(m)
  );
}

const SOURCE_TR: Record<string, string> = {
  user_stated: 'senin söylediğin',
  onboarding: 'kayıt sırasında',
  imported: 'önceki kayıtlardan',
  inferred: 'davranışından çıkardığım',
  confirmed: 'onayladığın',
};
const srcLabel = (s: string | null | undefined) => SOURCE_TR[s ?? ''] ? ` (${SOURCE_TR[s ?? '']})` : '';

// #arch step 1 (epistemics): a provenance label that also flags UNCONFIRMED beliefs (imported/
// inferred, never affirmed) so the glass-box is honest about what the coach is merely assuming.
// Safety is unaffected — an unconfirmed allergen is still enforced; this only invites confirmation.
const beliefLabel = (source: string | null | undefined, confirmedAt: string | null | undefined) => {
  const base = SOURCE_TR[source ?? ''] ?? '';
  if (!confirmedAt && (source === 'imported' || source === 'inferred')) {
    return base ? ` (${base} — doğrulamadım, hâlâ geçerli mi?)` : ' (doğrulamadım, hâlâ geçerli mi?)';
  }
  return base ? ` (${base})` : '';
};

// Injury subjects are stored in the guardrails' ENGLISH canonical vocabulary (knee/back/…) so the
// deterministic filter can match; translate them back to Turkish for the user-facing glass-box.
const BODYPART_TR: Record<string, string> = {
  knee: 'diz', back: 'bel/sırt', shoulder: 'omuz', ankle: 'ayak bileği', wrist: 'el bileği',
  elbow: 'dirsek', hip: 'kalça', neck: 'boyun', hamstring: 'arka bacak', quad: 'ön bacak', groin: 'kasık',
};
const bodyPartTr = (s: string) => BODYPART_TR[s] ?? s;

// Light display cleanup for food names stored in an inflected form ("brokoliyi"→"brokoli",
// "sütü"→"süt"). Cosmetic only (the stored value is untouched); strips a trailing Turkish
// accusative/possessive on words long enough that it's clearly a suffix.
function displayFood(name: string): string {
  const w = (name ?? '').trim();
  if (w.length <= 4) return w;
  return w.replace(/(yı|yi|yu|yü|nı|ni|nu|nü|ı|i|u|ü)$/u, '');
}

function num(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }

/**
 * Assemble the exact, provenance-tagged snapshot of what the coach knows. Each section is guarded
 * so a missing store never blanks the whole mirror.
 */
export async function buildMemoryMirror(userId: string): Promise<string> {
  const [profileRes, goalRes, constraintsRes, prefsRes, summaryRes] = await Promise.all([
    supabaseAdmin.from('profiles').select('weight_kg, height_cm, gender, birth_year, activity_level, dietary_restriction, diet_mode, alcohol_frequency, caffeine_intake, if_active, if_eating_start, if_eating_end, periodic_state, disliked_foods').eq('id', userId).maybeSingle(),
    supabaseAdmin.from('goals').select('goal_type, start_weight_kg, target_weight_kg, target_weeks, weekly_rate, phase_label').eq('user_id', userId).eq('is_active', true).maybeSingle(),
    supabaseAdmin.from('user_constraints').select('kind, subject, severity, body_parts, source, confirmed_at').eq('user_id', userId).eq('active', true),
    supabaseAdmin.from('food_preferences').select('food_name, preference, is_allergen').eq('user_id', userId),
    supabaseAdmin.from('ai_summary').select('behavioral_patterns, habit_progress, general_summary, learned_tone_preference').eq('user_id', userId).maybeSingle(),
  ]);

  const p = (profileRes.data ?? {}) as Record<string, unknown>;
  const goal = goalRes.data as Record<string, unknown> | null;
  const constraints = (constraintsRes.data ?? []) as Array<{ kind: string; subject: string; severity: string | null; body_parts: string[]; source: string; confirmed_at: string | null }>;
  const prefs = (prefsRes.data ?? []) as Array<{ food_name: string; preference: string; is_allergen: boolean }>;
  const summary = (summaryRes.data ?? {}) as Record<string, unknown>;

  const lines: string[] = [];
  lines.push('İşte seni şu an nasıl tanıdığım — hepsi bu, gizli bir şey yok. 👇');

  // ── Hedef ──
  const goalTypeTr: Record<string, string> = { lose_weight: 'kilo vermek', gain_weight: 'kilo almak', gain_muscle: 'kas kazanmak', maintain: 'kiloyu korumak', improve_health: 'sağlığı iyileştirmek' };
  if (goal?.goal_type) {
    const gt = goalTypeTr[goal.goal_type as string] ?? (goal.goal_type as string);
    const cur = num(p.weight_kg);
    const tgt = num(goal.target_weight_kg);
    const parts = [`**Hedefin:** ${gt}`];
    if (cur != null) parts.push(`şu anki kilon ~${cur} kg`);
    if (tgt != null) parts.push(`hedef ${tgt} kg`);
    if (num(goal.target_weeks)) parts.push(`${num(goal.target_weeks)} haftalık plan`);
    lines.push('\n' + parts.join(', ') + '.');
  } else {
    lines.push('\n**Hedefin:** henüz net bir hedef kaydetmedim — istersen birlikte belirleyelim.');
  }

  // ── Güvenlik / kısıtlamalar (the safety spine) ──
  const allergens = constraints.filter(c => c.kind === 'allergen' || c.kind === 'intolerance');
  const injuries = constraints.filter(c => c.kind === 'injury' || c.kind === 'surgery');
  const conditions = constraints.filter(c => c.kind === 'condition' || c.kind === 'medication');
  const dietaryC = constraints.filter(c => c.kind === 'dietary');
  const safety: string[] = [];
  if (allergens.length) safety.push('Alerji/İntolerans: ' + allergens.map(a => `${a.subject}${a.severity === 'severe' ? ' (ciddi)' : ''}${beliefLabel(a.source, a.confirmed_at)}`).join(', '));
  if (injuries.length) safety.push('Sakatlık: ' + injuries.map(i => {
    const label = (i.body_parts && i.body_parts.length) ? i.body_parts.map(bodyPartTr).join('/') : bodyPartTr(i.subject);
    return `${label}${beliefLabel(i.source, i.confirmed_at)}`;
  }).join(', '));
  if (conditions.length) safety.push('Sağlık durumu: ' + conditions.map(c => `${c.subject}${beliefLabel(c.source, c.confirmed_at)}`).join(', '));
  const dietaryProfile = (p.dietary_restriction as string | null)?.trim();
  const dietaryAll = [...new Set([...dietaryC.map(d => d.subject), ...(dietaryProfile ? [dietaryProfile] : [])])];
  if (dietaryAll.length) safety.push('Beslenme kısıtı: ' + dietaryAll.join(', '));
  if (safety.length) lines.push('\n**Sağlığın & güvenliğin (bunlara her zaman uyarım):**\n- ' + safety.join('\n- '));

  // ── Damak tadın ──
  const likes = prefs.filter(f => !f.is_allergen && (f.preference === 'like' || f.preference === 'love' || f.preference === 'can_cook')).map(f => f.food_name);
  const dislikes = prefs.filter(f => !f.is_allergen && (f.preference === 'dislike' || f.preference === 'never')).map(f => f.food_name);
  for (const it of ((p.disliked_foods as Array<{ item?: string }> | null) ?? [])) if (it?.item && !dislikes.includes(it.item)) dislikes.push(it.item);
  const taste: string[] = [];
  if (likes.length) taste.push('Sevdiklerin: ' + [...new Set(likes.map(displayFood))].slice(0, 12).join(', '));
  if (dislikes.length) taste.push('Sevmediklerin: ' + [...new Set(dislikes.map(displayFood))].slice(0, 12).join(', '));
  if (taste.length) lines.push('\n**Damak tadın:**\n- ' + taste.join('\n- '));

  // ── Düzenin ──
  const routine: string[] = [];
  if (p.diet_mode && p.diet_mode !== 'none') routine.push(`Diyet modu: ${p.diet_mode}`);
  if (p.if_active === true && p.if_eating_start && p.if_eating_end) routine.push(`Aralıklı oruç penceresi: ${p.if_eating_start}–${p.if_eating_end}`);
  if (p.periodic_state) routine.push(`Dönem: ${p.periodic_state}`);
  if (p.alcohol_frequency && p.alcohol_frequency === 'never') routine.push('Alkol: almıyorsun');
  if (['none', 'yok'].includes(String(p.caffeine_intake ?? ''))) routine.push('Kafein: tüketmiyorsun');
  if (routine.length) lines.push('\n**Düzenin:**\n- ' + routine.join('\n- '));

  // ── Seni tanıdıkça öğrendiklerim ──
  const learned: string[] = [];
  const bp = summary.behavioral_patterns;
  // FIX (audit HIGH — glass-box showed an EMPTY learned layer): behavioral_patterns are stored as
  // OBJECTS ({pattern|description|note|observation}) everywhere else (see buildKnowledgeSummary
  // below, which handles them), but this renderer kept only typeof==='string' entries — so the
  // headline "beni nasıl tanıyorsun?" feature looked like the coach had learned nothing.
  if (Array.isArray(bp)) {
    // FIX (adversarial): rendering objects un-hid RETRACTED beliefs — patterns carry a status
    // ('active' | 'candidate' | 'resolved', set at ai-chat 6048/6074/6177 incl. resolved_reason
    // 'user_correction'), and every other reader filters on it (context-builders ~398). Reading a
    // belief the user just corrected back to them as current is the worst failure on the very
    // surface that promises "correct me and I update". Filter FIRST, then take 4 — slicing before
    // filtering also let the OLDEST entries win on an append-ordered array.
    const candidates = (bp as unknown[])
      .map((x) => {
        if (typeof x === 'string') return x.trim() ? { txt: x.trim(), status: undefined as string | undefined } : null;
        if (!x || typeof x !== 'object') return null;
        const o = x as Record<string, unknown>;
        const txt = [o.description, o.pattern, o.note, o.observation, o.text]
          .find((v) => typeof v === 'string' && (v as string).trim()) as string | undefined;
        if (!txt) return null;
        return { txt: txt.trim(), status: typeof o.status === 'string' ? o.status : undefined };
      })
      .filter((e): e is { txt: string; status: string | undefined } => e !== null)
      // Keep entries with no status (back-compat) but drop the explicitly retired ones.
      .filter((e) => e.status !== 'resolved' && e.status !== 'stale')
      // Prefer confirmed patterns over unverified candidates.
      .sort((a, b) => (a.status === 'candidate' ? 1 : 0) - (b.status === 'candidate' ? 1 : 0));
    for (const e of candidates.slice(0, 4)) learned.push(e.txt);
  } else if (typeof bp === 'string' && bp.trim()) learned.push(bp.trim());
  const habits = summary.habit_progress;
  if (Array.isArray(habits)) {
    const active = (habits as Array<{ name?: string; habit?: string; status?: string; streak?: number }>).filter(h => h.status === 'active');
    for (const h of active.slice(0, 3)) learned.push(`${h.name ?? h.habit} alışkanlığı${h.streak ? ` (${h.streak} gün üst üste)` : ''}`);
  }
  if (learned.length) lines.push('\n**Seni tanıdıkça öğrendiklerim:**\n- ' + learned.slice(0, 6).join('\n- '));

  // ── Son öğrendiklerim (belief-log history — the JOURNEY, not just the current state) ──
  try {
    const KEY_TR: Record<string, string> = { dietary_restriction: 'beslenme tercihi', allergen: 'alerji', dislike: 'sevmediğin', goal: 'hedef', weight: 'kilo', injury: 'sakatlık' };
    const events = await getBeliefHistory(userId, undefined, 12);
    const shown: string[] = [];
    for (const e of events) {
      const key = String(e.belief_key ?? '');
      if (!KEY_TR[key]) continue; // skip internal events (plan_repair etc.)
      const when = String(e.created_at ?? '').split('T')[0];
      const subj = e.subject ? ` (${e.subject})` : '';
      const op = e.operation === 'retract' ? 'kaldırıldı' : e.operation === 'correct' ? 'güncellendi' : 'eklendi';
      shown.push(`${when}: ${KEY_TR[key]}${subj} ${op}`);
      if (shown.length >= 5) break;
    }
    if (shown.length) lines.push('\n**Son öğrendiklerim (zaman çizelgesi):**\n- ' + shown.join('\n- '));
  } catch { /* non-critical */ }

  // ── Correction invite (the write path) ──
  lines.push('\nBunlardan biri yanlış ya da değiştiyse söylemen yeter — mesela "artık sütü seviyorum", "alerjim geçti", "hedefim değişti" de, hemen güncellerim. Her şey her zaman senin kontrolünde. 🙌');

  return lines.join('\n');
}

/**
 * #S3 (structural rebuild): general_summary as a DERIVED VIEW — deterministically composed from
 * the canonical stores, never model-appended. This kills the append-log failure class at the root
 * (4 stale "[date] Kullanıcı 25 yaşında..." lines living side by side): the summary can no longer
 * accumulate or contradict, because it is REGENERATED whole from the same rows the app acts on.
 *
 * Deliberately excludes raw demographics (age/weight/height) — those live in the structured
 * profile and are injected into Layer-1 every turn; restating them here is what created the
 * 25-vs-35 contradiction. Front-loaded (goal+safety first) so the 500-char 'minimal' Layer-2
 * truncation keeps the most important lines. Output ≤ ~1600 chars.
 */
export async function composeGeneralSummary(userId: string): Promise<string> {
  const [profileRes, goalRes, constraintsRes, prefsRes, summaryRes] = await Promise.all([
    supabaseAdmin.from('profiles').select('weight_kg, activity_level, dietary_restriction, diet_mode, alcohol_frequency, caffeine_intake, if_active, if_eating_start, if_eating_end, periodic_state, meal_count_preference, meal_prep_time, occupation, motivation_source, biggest_challenge, sleep_quality, disliked_foods').eq('id', userId).maybeSingle(),
    supabaseAdmin.from('goals').select('goal_type, target_weight_kg, target_weeks, weekly_rate, phase_label').eq('user_id', userId).eq('is_active', true).maybeSingle(),
    supabaseAdmin.from('user_constraints').select('kind, subject, severity').eq('user_id', userId).eq('active', true),
    supabaseAdmin.from('food_preferences').select('food_name, preference, is_allergen').eq('user_id', userId),
    supabaseAdmin.from('ai_summary').select('behavioral_patterns, habit_progress').eq('user_id', userId).maybeSingle(),
  ]);
  // A failed READ must throw (caller catches → the stale-but-good summary survives) — otherwise
  // an empty compose would CLOBBER a meaningful summary through the merge.
  for (const r of [profileRes, goalRes, constraintsRes, prefsRes, summaryRes]) {
    if (r.error) throw new Error(`composeGeneralSummary read failed: ${r.error.message}`);
  }
  const p = (profileRes.data ?? {}) as Record<string, unknown>;
  const goal = goalRes.data as Record<string, unknown> | null;
  const cons = (constraintsRes.data ?? []) as Array<{ kind: string; subject: string; severity: string | null }>;
  const prefs = (prefsRes.data ?? []) as Array<{ food_name: string; preference: string; is_allergen: boolean }>;
  const summary = (summaryRes.data ?? {}) as Record<string, unknown>;

  const out: string[] = [];
  // 1) Goal + tempo (front-loaded — survives minimal-scope truncation)
  const goalTypeTr: Record<string, string> = { lose_weight: 'kilo vermek', gain_weight: 'kilo almak', gain_muscle: 'kas kazanmak', maintain: 'kiloyu korumak', improve_health: 'sağlığı iyileştirmek', health: 'sağlıklı yaşamak', conditioning: 'kondisyon' };
  if (goal?.goal_type) {
    const bits = [`Hedef: ${goalTypeTr[goal.goal_type as string] ?? goal.goal_type}`];
    if (num(goal.target_weight_kg)) bits.push(`hedef ${num(goal.target_weight_kg)} kg`);
    if (num(goal.target_weeks)) bits.push(`${num(goal.target_weeks)} hafta`);
    if (goal.phase_label) bits.push(String(goal.phase_label));
    out.push(bits.join(', ') + '.');
  }
  // 2) Safety spine one-liner
  const allg = cons.filter(c => c.kind === 'allergen' || c.kind === 'intolerance').map(c => c.subject);
  const surg = cons.filter(c => c.kind === 'surgery').map(c => c.subject);
  const cond = cons.filter(c => c.kind === 'condition').map(c => c.subject);
  const inj = cons.filter(c => c.kind === 'injury').map(c => c.subject);
  const saf: string[] = [];
  if (surg.length) saf.push(`ameliyat geçmişi: ${surg.slice(0, 3).join(', ')}`);
  if (cond.length) saf.push(`kronik: ${cond.slice(0, 3).join(', ')}`);
  if (allg.length) saf.push(`alerji: ${allg.slice(0, 4).join(', ')}`);
  if (inj.length) saf.push(`sakatlık: ${inj.slice(0, 3).join(', ')}`);
  if (saf.length) out.push('Sağlık: ' + saf.join(' | ') + '.');
  // 3) Routine
  const rout: string[] = [];
  if (p.dietary_restriction) rout.push(String(p.dietary_restriction));
  if (p.diet_mode && p.diet_mode !== 'standard' && p.diet_mode !== 'none') rout.push(`${p.diet_mode} beslenme`);
  if (p.if_active === true && p.if_eating_start) rout.push(`IF ${p.if_eating_start}–${p.if_eating_end}`);
  if (p.activity_level) rout.push(`aktivite: ${p.activity_level}`);
  if (p.meal_count_preference) rout.push(`${p.meal_count_preference} öğün tercihi`);
  if (String(p.meal_prep_time ?? '').match(/kısa|kisa|hızlı|hizli|15|10 dk/i)) rout.push('hızlı hazırlık ister');
  if (p.periodic_state) rout.push(`dönem: ${p.periodic_state}`);
  if (p.alcohol_frequency === 'never') rout.push('alkol yok');
  if (rout.length) out.push('Düzen: ' + rout.join(', ') + '.');
  // 4) Taste (compact)
  const dislikes = [...new Set([
    ...prefs.filter(f => !f.is_allergen && (f.preference === 'dislike' || f.preference === 'never')).map(f => displayFood(f.food_name)),
    ...(((p.disliked_foods as Array<{ item?: string }> | null) ?? []).map(it => it?.item).filter(Boolean) as string[]).map(displayFood),
  ])];
  const likes = [...new Set(prefs.filter(f => !f.is_allergen && (f.preference === 'love' || f.preference === 'like')).map(f => displayFood(f.food_name)))];
  if (likes.length) out.push('Sever: ' + likes.slice(0, 8).join(', ') + '.');
  if (dislikes.length) out.push('Sevmez: ' + dislikes.slice(0, 8).join(', ') + '.');
  // 5) Motivation / context
  const mot: string[] = [];
  if (p.motivation_source) mot.push(`motivasyon: ${String(p.motivation_source).slice(0, 60)}`);
  if (p.biggest_challenge) mot.push(`zorlandığı: ${String(p.biggest_challenge).slice(0, 60)}`);
  if (p.occupation) mot.push(`iş: ${String(p.occupation).slice(0, 40)}`);
  if (mot.length) out.push(mot.join(' | ') + '.');
  // 6) Top behavioral patterns (the genuinely-learned layer)
  const beh: string[] = [];
  const bp = summary.behavioral_patterns;
  if (Array.isArray(bp)) {
    for (const x of bp.slice(0, 3)) {
      if (typeof x === 'string') beh.push(x);
      else if (x && typeof x === 'object' && typeof (x as Record<string, unknown>).description === 'string') beh.push((x as Record<string, unknown>).description as string);
    }
  }
  if (beh.length) out.push('Gözlemler: ' + beh.join('; ') + '.');

  return out.join('\n').slice(0, 1600);
}
