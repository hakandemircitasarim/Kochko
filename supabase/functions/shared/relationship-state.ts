/**
 * relationship-state.ts — the maturity of the coaching relationship (target-arch step 13).
 *
 * ONE "how well do I know this person" variable, computed from tenure + engagement, that replaces
 * the ad-hoc day/week/message thresholds scattered across persona detection ("100+ mesaj"),
 * progressive disclosure ("1. gün / 3-5. gün / 2. hafta"), tone evolution, etc. The coach reads a
 * single phase and adjusts tone / proactivity / assertiveness coherently. Dormancy/return is left
 * to the existing return-flow context; this is the STRANGER→ESTABLISHED ladder.
 *
 * Computed on read (cheap, always fresh) — no stored state to drift.
 */
import { supabaseAdmin } from './supabase-admin.ts';

export type RelationshipPhase = 'STRANGER' | 'ACQUAINTED' | 'LEARNING' | 'WARM' | 'ESTABLISHED';
const RANK: Record<RelationshipPhase, number> = { STRANGER: 0, ACQUAINTED: 1, LEARNING: 2, WARM: 3, ESTABLISHED: 4 };
const NAME: RelationshipPhase[] = ['STRANGER', 'ACQUAINTED', 'LEARNING', 'WARM', 'ESTABLISHED'];

export interface Relationship { phase: RelationshipPhase; daysKnown: number; messages: number; }

/** Per-phase coaching guidance (tone / proactivity / assertiveness). */
const PHASE_GUIDE: Record<RelationshipPhase, string> = {
  STRANGER: 'Daha yeni tanışıyorsunuz. Kısaca kendini tanıt, temel bilgileri (hedef, alışkanlıklar) sıcak ama ısrarsız topla. Aşırı samimi/laubali olma, geçmişe referans verme (henüz yok).',
  ACQUAINTED: 'Birkaç gündür tanışıyorsunuz. Temelleri öğrendin; nazikçe derinleş, tercihlerini keşfet. Çok iddialı tavsiyelerden kaçın, güven inşa et.',
  LEARNING: 'Onu aktif tanıyorsun. Kalıplarını, tetikleyicilerini, tercihlerini öğren ve kaydet. Küçük başarıları fark et. Henüz her şeyi bildiğini varsayma.',
  WARM: 'Onu artık iyi tanıyorsun. Geçmiş verilerine ve alışkanlıklarına doğal referanslar ver, kişisel ol, proaktif nudge’lar uygun. Gerektiğinde net tavsiye ver.',
  ESTABLISHED: 'Köklü bir ilişkin var. Onu derinlemesine tanıyorsun; kısa, doğrudan, kişisel konuş. Yolculuğun tamamına referans ver, gerektiğinde dürüstçe zorla — güven yerinde.',
};

export async function getRelationshipPhase(userId: string): Promise<Relationship> {
  try {
    const [profRes, cntRes] = await Promise.all([
      supabaseAdmin.from('profiles').select('created_at').eq('id', userId).maybeSingle(),
      supabaseAdmin.from('chat_messages').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    ]);
    const signup = (profRes.data?.created_at as string | null) ? new Date(profRes.data!.created_at as string) : new Date();
    const daysKnown = Math.max(0, Math.floor((Date.now() - signup.getTime()) / 86400000));
    const messages = cntRes.count ?? 0;

    // Tenure ladder.
    const tenure: RelationshipPhase =
      (daysKnown <= 0 || messages < 4) ? 'STRANGER'
      : daysKnown <= 2 ? 'ACQUAINTED'
      : daysKnown <= 14 ? 'LEARNING'
      : daysKnown <= 60 ? 'WARM' : 'ESTABLISHED';
    // Engagement can only PROMOTE (a very active new user is "known" faster), never demote.
    const engage: RelationshipPhase =
      messages >= 200 ? 'WARM' : messages >= 40 ? 'LEARNING' : messages >= 8 ? 'ACQUAINTED' : 'STRANGER';
    const phase = NAME[Math.max(RANK[tenure], RANK[engage])];
    return { phase, daysKnown, messages };
  } catch { return { phase: 'STRANGER', daysKnown: 0, messages: 0 }; }
}

export function relationshipGuidance(r: Relationship): string {
  return `İLİŞKİ (${r.phase}, ${r.daysKnown}g / ${r.messages} mesaj): ${PHASE_GUIDE[r.phase]}`;
}
