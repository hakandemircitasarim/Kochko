/**
 * mem#9: is a user message TODAY's weigh-in, or a question / plateau / history remark that merely
 * contains a weight? "son 3 haftadir kilom hic degismiyor 82.5ta takildim, neden olabilir?" came
 * back with a model-emitted weight_log: a weigh-in that never happened landed on today, triggered a
 * TDEE recalculation (2800 → 3062) and closed the pending weigh-in reminder.
 *
 * Rule: a clear weigh-in cue always wins ("82.5 geldim", "bu sabah 82", "tartıldım", "86 kiloyum").
 * Without one, a question frame or a plateau/past frame means it is NOT a weigh-in. A plain
 * statement ("82.5", "kilom 82") stays a weigh-in, as before.
 *
 * Pure (no DB) so it is unit-tested; ai-chat applies it to model-emitted weight writes.
 */

const NA = '(?<![\\p{L}])'; // Turkish-aware word start (JS \b is ASCII-only)
const NB = '(?![\\p{L}])';  // Turkish-aware word end

// A number right before a weigh-in verb: "82.5 geldim", "82'ye düştüm", "80 kiloya indim", "85 kg oldum".
const NUMBER_VERB = `\\d(?:[.,]\\d+)?\\s*(?:kg|kilo)?\\s*'?\\s*(?:y?[ae])?\\s*(?:geldim|oldum|indim|d[üu][şs]t[üu]m|[çc][ıi]kt[ıi]m)${NB}`;
// "82.5'im", "82'yim", "86 kiloyum", "86 kilodayım".
const NUMBER_COPULA = `(?<!\\d)\\d{2,3}(?:[.,]\\d+)?\\s*(?:'\\s*y?[ıiuü]m|y[ıiuü]m|\\s*kiloyum|\\s*kilo(?:day[ıi]m|da\\s*y[ıi]m))${NB}`;
// "bugün 82.5", "bu sabah 82", "şu an 82", optionally "bu sabah tartıda 82". A body-weight-range
// number (30-299) that is not followed by another unit ("bugün 12 bin adım", "bugün 30 dk").
const NOW_NUMBER = `${NA}(?:bu\\s*sabah|bug[üu]n|[şs]u\\s*an(?:da)?|[şs]uan)\\s*(?:tart[ıi]da\\s*)?(?:[3-9]\\d|[12]\\d\\d)(?:[.,]\\d+)?(?!\\d)(?:\\s*(?:kg|kilo)|\\s*'|\\s*[,.!]|\\s*$|\\s+(?:geld|old|g[öo]ster|[çc][ıi]kt))`;
const WEIGH_IN_CUE = new RegExp([
  `${NA}tart[ıi]ld`,                 // tartıldım, tartıldık, tartıldığımda (not "tartılmadım")
  `${NA}tart[ıi](?:da|ya|m)${NB}`,    // tartıda / tartıya çıktım / tartım 82
  `${NA}a[çc]\\s*karn[ıi]na`,         // the weigh-in ritual
  NUMBER_VERB, NUMBER_COPULA, NOW_NUMBER,
].join('|'), 'u');

const QUESTION_FRAME = new RegExp([
  '\\?',
  `${NA}(?:neden|nedeni|ni[çc]in|niye|nas[ıi]l|sebe[bp]\\p{L}*|olabilir)${NB}`,
  `${NA}m[ıiuü](?:s[ıiuü]n|y[ıiuü]m|y[ıiuü]z)?${NB}`, // question particle: "normal mi", "doğru mu"
].join('|'), 'u');

const HISTORY_FRAME = new RegExp([
  `${NA}tak[ıi]l`,                                         // takıldım, takılı kaldım
  `${NA}de[ğg]i[şs]mi?yor|${NA}de[ğg]i[şs]medi`,          // değişmiyor / değişmedi
  `${NA}(?:oynam[ıi]yor|inmiyor|d[üu][şs]m[üu]yor|veremiyorum|vermiyorum|sabit|plato)`,
  `${NA}(?:hafta|ay|g[üu]n|y[ıi]l)(?:lar|ler)?d[ıiuü]r${NB}`, // haftadır, aylardır, gündür, günlerdir
  `${NA}(?:ge[çc]en|[öo]nceden|eskiden)${NB}`,
  `${NA}[öo]nce${NB}`,
  `\\d\\s*'?\\s*(?:kilo)?y?d[ıiuü]m${NB}`,                  // "95 kiloydum", "82'ydim"
].join('|'), 'u');

export type WeighInVerdict = { keep: boolean; reason: 'weigh_in_cue' | 'question' | 'history' | 'plain_statement' };

export function judgeTodayWeighIn(message: string): WeighInVerdict {
  const m = (message ?? '').toLocaleLowerCase('tr');
  if (WEIGH_IN_CUE.test(m)) return { keep: true, reason: 'weigh_in_cue' };
  if (QUESTION_FRAME.test(m)) return { keep: false, reason: 'question' };
  if (HISTORY_FRAME.test(m)) return { keep: false, reason: 'history' };
  return { keep: true, reason: 'plain_statement' };
}
