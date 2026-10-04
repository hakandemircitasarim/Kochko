/**
 * Canonical trigger keys for the proactive nudge loop.
 *
 * Each "TETIK: LABEL - detail" line of the evidence context becomes a stable snake_case key (the
 * same situation always yields the same key, whatever words the model would have chosen), plus the
 * non-TETIK risk signals. coaching_messages.trigger_type stores ONLY these, so dedupe, cooldown and
 * per-type notification preferences can actually match.
 */

/** Turkish-folding snake_case slug: "GEÇİŞ YAKLAŞIYOR" → "gecis_yaklasiyor". */
export function triggerSlug(t: string): string {
  return t.toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

/**
 * Keys present in an EVIDENCE context. Only line-initial "TETIK:" counts: the same prompt also
 * lists today's already-sent messages as "- [trigger] content", and a stored message that quoted a
 * TETIK must never resurrect itself as fresh evidence.
 */
export function nudgeTriggerKeys(context: string): string[] {
  const keys = new Set<string>();
  for (const m of context.matchAll(/^TETIK:\s*([^\n—-]+)/gm)) {
    const k = triggerSlug(m[1]);
    if (k) keys.add(k);
  }
  if (/^ATISTIRMA RISKI:/m.test(context)) keys.add('atistirma_riski');
  if (/^ALKOL-SAPMA RISKI:/m.test(context)) keys.add('alkol_sapma_riski');
  if (/^MOTIVASYON DUSUSU:/m.test(context)) keys.add('motivasyon_dususu');
  if (/^PREDIKTIF RISK/m.test(context)) keys.add('prediktif_risk');
  if (/^TAKIP:/m.test(context)) keys.add('taahhut_takibi');
  if (/^Gece riski: AKTIF/m.test(context)) keys.add('gece_riski');
  // Adaptive-difficulty outreach ("plan bu kisi icin FAZLA BUYUK") arrives as a markdown section,
  // not a TETIK line — without this the evidence gate would silently drop it.
  if (/^## KAPASITE UYUMSUZLUGU/m.test(context)) keys.add('kapasite_uyumsuzlugu');
  return [...keys];
}
