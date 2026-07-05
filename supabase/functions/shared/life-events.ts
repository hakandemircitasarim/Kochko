/**
 * Episodic life-event capture + Turkish future-date parsing.
 *
 * Powers the "organism" continuity feature: when a user mentions a dated motivating event
 * ("3 hafta sonra kardeşimin düğünü var", "15 temmuzda tatile gidiyorum", "cumartesi mezuniyetim"),
 * we persist it to life_events so the coach carries it as a countdown on EVERY future turn (and in
 * new sessions) and ties the plan to it. Deterministic + resilient — the model can also emit a
 * life_event action for cases the net misses.
 */

const MONTHS: Record<string, number> = {
  ocak: 1, şubat: 2, subat: 2, mart: 3, nisan: 4, mayıs: 5, mayis: 5, haziran: 6,
  temmuz: 7, ağustos: 8, agustos: 8, eylül: 9, eylul: 9, ekim: 10, kasım: 11, kasim: 11, aralık: 12, aralik: 12,
};
// 0=Sunday … 6=Saturday (JS getUTCDay)
const DAYNAMES: Record<string, number> = {
  pazartesi: 1, salı: 2, sali: 2, çarşamba: 3, carsamba: 3, perşembe: 4, persembe: 4,
  cumartesi: 6, cuma: 5, pazar: 0,
};

/** Parse the FIRST future date reference in a Turkish message → ISO yyyy-mm-dd, or null. */
export function parseFutureDate(text: string, todayISO: string): string | null {
  const m = text.toLocaleLowerCase('tr');
  const today = new Date(`${todayISO}T00:00:00Z`);
  const add = (days: number) => { const d = new Date(today); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

  // "N gün/hafta/ay sonra|içinde|kaldı"
  let mm = m.match(/(\d{1,3})\s*(gün|gun|hafta|ay)\s*(sonra|içinde|icinde|kaldı|kaldi|var)/);
  if (mm) { const n = parseInt(mm[1]); const u = mm[2]; return add(u.startsWith('gün') || u.startsWith('gun') ? n : u === 'hafta' ? n * 7 : n * 30); }

  // "15 temmuz(da)" specific day+month (this year, or next if already passed)
  mm = m.match(/(\d{1,2})\s*(ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik)/);
  if (mm) {
    const day = parseInt(mm[1]); const mon = MONTHS[mm[2]];
    if (day >= 1 && day <= 31) {
      const y = today.getUTCFullYear();
      let d = new Date(Date.UTC(y, mon - 1, day));
      if (d.getTime() < today.getTime()) d = new Date(Date.UTC(y + 1, mon - 1, day));
      return d.toISOString().slice(0, 10);
    }
  }

  // "gelecek/önümüzdeki ay" | "gelecek/önümüzdeki hafta" | "haftaya"
  if (/(gelecek|önümüzdeki|onumuzdeki)\s*ay/.test(m)) return add(30);
  if (/(gelecek|önümüzdeki|onumuzdeki)\s*hafta|haftaya/.test(m)) return add(7);

  // "yarından sonra / öbür gün" before "yarın"
  if (/yarından sonra|yarindan sonra|öbür gün|obur gun/.test(m)) return add(2);
  if (/yarın|yarin/.test(m)) return add(1);

  // day-of-week → next occurrence (+7 more when "gelecek/önümüzdeki")
  mm = m.match(/(pazartesi|salı|sali|çarşamba|carsamba|perşembe|persembe|cumartesi|cuma|pazar)/);
  if (mm) {
    const target = DAYNAMES[mm[1]];
    const cur = today.getUTCDay();
    let diff = (target - cur + 7) % 7;
    if (diff === 0) diff = 7; // naming today's weekday means the NEXT one
    if (/gelecek|önümüzdeki|onumuzdeki/.test(m)) diff += 7;
    return add(diff);
  }

  return null;
}

const EVENT_TYPES: { re: RegExp; type: string; canon: string }[] = [
  { re: /(düğün|dugun)/, type: 'wedding', canon: 'düğün' },
  { re: /nişan/, type: 'engagement', canon: 'nişan' }, // 'nisan' (April) deliberately excluded
  { re: /(kına|kina)/, type: 'henna', canon: 'kına' },
  { re: /(tatil|seyahat|\bgezi\b|\btur\b)/, type: 'vacation', canon: 'tatil' },
  { re: /(plaj|bikini|\bmayo\b|denize gir|yaza gir|yaz gel)/, type: 'beach', canon: 'yaz/plaj' },
  { re: /mezuniyet/, type: 'graduation', canon: 'mezuniyet' },
  { re: /(doğum ?günü|dogum ?gunu|yaş günü|yas gunu)/, type: 'birthday', canon: 'doğum günü' },
  { re: /(buluşma|bulusma|kavuşma|kavusma|toplanma|reunion)/, type: 'reunion', canon: 'buluşma' },
  { re: /(sınav|sinav|\bfinal\b|\bvize\b)/, type: 'exam', canon: 'sınav' },
  { re: /(fotoğraf çekimi|foto çekimi|foto cekimi|çekim var|photoshoot)/, type: 'photoshoot', canon: 'fotoğraf çekimi' },
  { re: /(yarışma|yarisma|müsabaka|musabaka|maraton|turnuva)/, type: 'competition', canon: 'yarışma' },
  { re: /\bbalo\b/, type: 'prom', canon: 'balo' },
];

/**
 * Detect a motivating dated event. Requires BOTH an event keyword AND a future date in the message
 * (co-occurrence keeps false positives near zero). Returns null otherwise.
 */
export function extractLifeEvent(text: string, todayISO: string): { title: string; event_type: string; event_date: string } | null {
  if (!text) return null;
  const m = text.toLocaleLowerCase('tr');
  // Negative guard: not a cancellation / past reference.
  if (/(iptal|geçti|gecti|oldu bitti|geçen|gecen hafta|geçen ay|gecen ay)/.test(m)) return null;
  let ev: { type: string; canon: string; kw: string } | null = null;
  for (const e of EVENT_TYPES) { const mt = m.match(e.re); if (mt) { ev = { type: e.type, canon: e.canon, kw: mt[1] ?? mt[0] }; break; } }
  if (!ev) return null;
  const date = parseFutureDate(m, todayISO);
  if (!date) return null;
  // sanity: within the next ~2 years
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${todayISO}T00:00:00Z`)) / 86400000);
  if (days < 0 || days > 760) return null;

  // Title = optional possessor word (genitive/possessive) + canonical noun. "kardeşimin düğünü".
  const idx = m.indexOf(ev.kw);
  const pre = idx > 0 ? (m.slice(0, idx).trim().split(/\s+/).pop() ?? '') : '';
  const POSS_STOP = new Set(['yarın', 'yarin', 'bugün', 'bugun', 'hafta', 'ay', 'gün', 'gun', 'sonra', 'önce', 'once', 'için', 'icin', 'bir', 'çok', 'cok', 'sonrasında', 'içinde', 'icinde']);
  const possessor = /(ın|in|un|ün|nın|nin|nun|nün|im|ım|um|üm|isi|ısi|usu|üsü)$/.test(pre) && pre.length >= 3 && !POSS_STOP.has(pre) ? `${pre} ` : '';
  const title = `${possessor}${ev.canon}`.trim().slice(0, 80);
  return { title, event_type: ev.type, event_date: date };
}
