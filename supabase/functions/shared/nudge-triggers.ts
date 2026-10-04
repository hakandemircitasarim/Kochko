/**
 * Canonical trigger keys present in a nudge context. Each "TETIK: LABEL - detail" line becomes a
 * stable snake_case key (the same situation always yields the same key, whatever words the model
 * would have chosen), plus the non-TETIK risk signals. coaching_messages.trigger_type stores ONLY
 * these, so dedupe and per-type preferences can actually match.
 */
export function nudgeTriggerKeys(context: string): string[] {
  const keys = new Set<string>();
  const slug = (t: string) => t.toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  for (const m of context.matchAll(/TETIK:\s*([^\n—-]+)/g)) {
    const k = slug(m[1]).slice(0, 48);
    if (k) keys.add(k);
  }
  if (/ATISTIRMA RISKI:/.test(context)) keys.add('atistirma_riski');
  if (/ALKOL-SAPMA RISKI:/.test(context)) keys.add('alkol_sapma_riski');
  if (/MOTIVASYON DUSUSU:/.test(context)) keys.add('motivasyon_dususu');
  if (/PREDIKTIF RISK/.test(context)) keys.add('prediktif_risk');
  if (/^TAKIP:/m.test(context)) keys.add('taahhut_takibi');
  if (/Gece riski: AKTIF/.test(context)) keys.add('gece_riski');
  return [...keys];
}
