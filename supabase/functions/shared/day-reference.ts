/**
 * diff#4: WHICH DAY is a what-if about? "yarın akşam 2 dilim pizza yesem?" was measured against
 * TODAY's leftover (1800 of 2000 eaten → "üzeri ~370") and, on a Sunday, charged to this week's
 * budget although Monday starts a new one. This resolves the referenced FUTURE day from the message;
 * null means today (no day named, a today cue, or only past days named — "dün çok yedim, pizza
 * yesem?" is still about today).
 *
 * Pure (no DB) so it is unit-tested; the budget snapshot uses the result.
 */
import { shiftDateString } from './day-boundary.ts';

export interface DayReference { date: string; label: string }

const NB = '(?![\\p{L}])';   // Turkish-aware word end (JS \b is ASCII-only)
const NA = '(?<![\\p{L}])';  // Turkish-aware word start

// Index 0 = Monday (ISO week, like every budget week in this codebase).
const WEEKDAYS: { re: string; label: string }[] = [
  { re: 'pazartesi', label: 'pazartesi' },
  { re: 'sal[ıi]', label: 'salı' },
  { re: '[çc]ar[şs]amba', label: 'çarşamba' },
  { re: 'per[şs]embe', label: 'perşembe' },
  { re: 'cuma', label: 'cuma' },
  { re: 'cumartesi', label: 'cumartesi' },
  { re: 'pazar', label: 'pazar' },
];
// Day-word suffixes we accept: "cumaya", "salıki", "cumartesi günü/akşamı/sabahı". Bare "pazar" is
// also the market ("pazarda", "pazara"), so it gets NO case suffix and not "pazar yeri/alışverişi".
const DAY_SUFFIX = '(?:y[ae]|ki|\\s+g[üu]n[üu]|\\s+ak[şs]am[ıi]?|\\s+sabah[ıi]?|\\s+[öo][ğg]le(?:n|si)?)?';
const PAZAR_SUFFIX = '(?:ki|\\s+g[üu]n[üu]|\\s+ak[şs]am[ıi]?|\\s+sabah[ıi]?|\\s+[öo][ğg]le(?:n|si)?)?(?!\\s+(?:yeri|al[ıi][şs]veri))';

const TODAY_RE = new RegExp(`${NA}(?:bug[üu]n(?:k[üu]|e|den)?|bu\\s*ak[şs]am|bu\\s*gece|bu\\s*sabah|bu\\s*[öo][ğg]le(?:n|den)?|[şs]imdi|[şs]u\\s*an(?:da)?|[şs]uan)${NB}`, 'gu');
const TOMORROW_RE = new RegExp(`${NA}yar[ıi]n(?:ki|a|da)?${NB}`, 'gu');
const DAY_AFTER_RE = new RegExp(`${NA}[öo]b[üu]r\\s*g[üu]n${NB}`, 'gu');
const IN_N_DAYS_RE = new RegExp(`${NA}(\\d{1,2})\\s*g[üu]n\\s*sonra${NB}`, 'gu');
const WEEKEND_RE = new RegExp(`${NA}hafta\\s*sonu(?:na|nda)?${NB}`, 'gu');
const NEXT_WEEK_RE = new RegExp(`${NA}(?:haftaya|gelecek\\s+hafta(?:ya)?|[öo]n[üu]m[üu]zdeki\\s+hafta(?:ya)?)${NB}`, 'gu');
const HYPOTHETICAL_RE = new RegExp(`${NA}(?:yesem|yersem|yiyeyim|yesek|yersek|i[çc]sem|i[çc]ersem|istesem|gitsem|gidersem)${NB}`, 'u');

/** 0 = Monday … 6 = Sunday, for a YYYY-MM-DD string. */
function isoDow(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 6 : d - 1;
}

type Mention = { index: number; end: number; ref: DayReference | null };

/** All day mentions in the (lower-cased) message; ref null = a today cue. */
function collectMentions(m: string, today: string): Mention[] {
  const out: Mention[] = [];
  const push = (re: RegExp, make: (x: RegExpExecArray) => DayReference | null | undefined) => {
    re.lastIndex = 0;
    for (let x = re.exec(m); x; x = re.exec(m)) {
      const ref = make(x);
      if (ref !== undefined) out.push({ index: x.index, end: x.index + x[0].length, ref });
    }
  };
  const todayDow = isoDow(today);
  push(TODAY_RE, () => null);
  push(TOMORROW_RE, () => ({ date: shiftDateString(today, 1), label: 'yarın' }));
  push(DAY_AFTER_RE, () => ({ date: shiftDateString(today, 2), label: 'öbür gün' }));
  push(IN_N_DAYS_RE, (x) => {
    const n = parseInt(x[1], 10);
    return n >= 1 && n <= 14 ? { date: shiftDateString(today, n), label: `${n} gün sonra` } : undefined;
  });
  const nextWeekMonday = shiftDateString(today, 7 - todayDow);
  const nextWeekBefore = (at: number) =>
    /(?:haftaya|gelecek\s+hafta|[öo]n[üu]m[üu]zdeki\s+hafta)\s*$/u.test(m.slice(Math.max(0, at - 24), at));
  // Weekend: Saturday of this week (on Saturday/Sunday it is today); "gelecek hafta sonu" → next week's.
  push(WEEKEND_RE, (x) => {
    if (/(?:gelecek|[öo]n[üu]m[üu]zdeki)\s+$/u.test(m.slice(Math.max(0, x.index - 16), x.index))) {
      return { date: shiftDateString(nextWeekMonday, 5), label: 'gelecek hafta sonu' };
    }
    return todayDow >= 5 ? null : { date: shiftDateString(today, 5 - todayDow), label: 'hafta sonu' };
  });
  WEEKDAYS.forEach((wd, idx) => {
    const re = new RegExp(`${NA}${wd.re}${idx === 6 ? PAZAR_SUFFIX : DAY_SUFFIX}${NB}`, 'gu');
    push(re, (x) => {
      // "haftaya salı" = Tuesday of NEXT week, whatever today is.
      if (nextWeekBefore(x.index)) return { date: shiftDateString(nextWeekMonday, idx), label: `haftaya ${wd.label}` };
      if (idx === todayDow) return null; // "cuma" said on a Friday is today
      const ahead = (idx - todayDow + 7) % 7;
      return { date: shiftDateString(today, ahead), label: wd.label };
    });
  });
  // A bare "haftaya / gelecek hafta" (no weekday right after it): next week, anchored on its Monday.
  push(NEXT_WEEK_RE, (x) => {
    const after = m.slice(x.index + x[0].length);
    // A weekday or "sonu" right after it is covered by that mention.
    if (/^\s*sonu/u.test(after) || WEEKDAYS.some((wd) => new RegExp(`^\\s*${wd.re}`, 'u').test(after))) return undefined;
    return { date: nextWeekMonday, label: 'gelecek hafta' };
  });
  return out.sort((a, b) => a.index - b.index);
}

/**
 * The future day a what-if message is about, or null for today. With several day words the one
 * nearest BEFORE the hypothetical verb wins ("bugün çok yedim, yarın pizza yesem?" → yarın;
 * "yarın spor var, bu akşam pizza yesem?" → today). Turkish puts the time before the verb, so a day
 * word only AFTER it is the consequence, not the meal's day ("pizza yesem yarın tartıda ne olur?"
 * → today). With no hypothetical verb the first day word wins.
 */
export function simulationTargetDay(message: string, today: string): DayReference | null {
  const m = (message ?? '').toLocaleLowerCase('tr');
  if (!m.trim()) return null;
  const mentions = collectMentions(m, today);
  if (mentions.length === 0) return null;
  const verb = HYPOTHETICAL_RE.exec(m);
  const pick = verb
    ? mentions.filter((x) => x.end <= verb.index).pop() ?? null
    : mentions[0];
  const ref = pick?.ref ?? null;
  return ref && ref.date > today ? ref : null;
}
