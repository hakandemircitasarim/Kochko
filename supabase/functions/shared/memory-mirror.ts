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
    supabaseAdmin.from('user_constraints').select('kind, subject, severity, body_parts, source').eq('user_id', userId).eq('active', true),
    supabaseAdmin.from('food_preferences').select('food_name, preference, is_allergen').eq('user_id', userId),
    supabaseAdmin.from('ai_summary').select('behavioral_patterns, habit_progress, general_summary, learned_tone_preference').eq('user_id', userId).maybeSingle(),
  ]);

  const p = (profileRes.data ?? {}) as Record<string, unknown>;
  const goal = goalRes.data as Record<string, unknown> | null;
  const constraints = (constraintsRes.data ?? []) as Array<{ kind: string; subject: string; severity: string | null; body_parts: string[]; source: string }>;
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
  if (allergens.length) safety.push('Alerji/İntolerans: ' + allergens.map(a => `${a.subject}${a.severity === 'severe' ? ' (ciddi)' : ''}${srcLabel(a.source)}`).join(', '));
  if (injuries.length) safety.push('Sakatlık: ' + injuries.map(i => {
    const label = (i.body_parts && i.body_parts.length) ? i.body_parts.map(bodyPartTr).join('/') : bodyPartTr(i.subject);
    return `${label}${srcLabel(i.source)}`;
  }).join(', '));
  if (conditions.length) safety.push('Sağlık durumu: ' + conditions.map(c => `${c.subject}${srcLabel(c.source)}`).join(', '));
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
  if (Array.isArray(bp)) { for (const x of bp.slice(0, 4)) if (typeof x === 'string') learned.push(x); }
  else if (typeof bp === 'string' && bp.trim()) learned.push(bp.trim());
  const habits = summary.habit_progress;
  if (Array.isArray(habits)) {
    const active = (habits as Array<{ name?: string; habit?: string; status?: string; streak?: number }>).filter(h => h.status === 'active');
    for (const h of active.slice(0, 3)) learned.push(`${h.name ?? h.habit} alışkanlığı${h.streak ? ` (${h.streak} gün üst üste)` : ''}`);
  }
  if (learned.length) lines.push('\n**Seni tanıdıkça öğrendiklerim:**\n- ' + learned.slice(0, 6).join('\n- '));

  // ── Correction invite (the write path) ──
  lines.push('\nBunlardan biri yanlış ya da değiştiyse söylemen yeter — mesela "artık sütü seviyorum", "alerjim geçti", "hedefim değişti" de, hemen güncellerim. Her şey her zaman senin kontrolünde. 🙌');

  return lines.join('\n');
}
