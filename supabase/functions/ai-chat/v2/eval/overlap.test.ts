/**
 * Teaching-to-the-test guard (2026-10-11 review of tuning round 1): no few-shot, rule example or
 * registry-doc example may be a copy of an eval fixture — otherwise that fixture grades recall of
 * the example, not understanding. The holdout set (tag 'holdout') must also be fresh wording: no
 * near-copy of any tuning fixture or prompt example. Round 3 (review of tuning round 2): the same
 * CASE in other words is a copy too — shared content words (by stem) or a shared number+word pair —
 * and the coach's capability text is held to the same checks. Round 4 (review of tuning round 3):
 * spelled numerals pair like digits, "dilim"/"ciddi"/"alerji" are content, and the tripwire questions
 * Stage A reads on a turn may not describe the fixture they fire on.
 */
import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { buildWriteDoc } from '../../../shared/write-registry/mod.ts';
import { buildCapabilities } from '../../../shared/write-registry/capabilities.ts';
import {
  AMBIGUOUS_TRIPWIRES, EXPLICIT_TRIPWIRES, scanTripwires, SIGNAL_TRIPWIRES, type TripwireDef, tripwireFacts, V1_AMBIGUOUS_FLOOR_TRIPWIRES,
  V1_FLOOR_TRIPWIRES,
} from '../../../shared/safety-tripwires.ts';
import { UNDERSTAND_FEW_SHOTS, UNDERSTAND_RULES } from '../understand-prompt.ts';
import { loadFixtureDir } from './fixtures.ts';
import {
  capabilityExamples, CONTENT_SHARED_MAX, CONTENT_WORDS_KEPT, containsRun, contentOverlaps, contentStems, contextRefLine, foldTokens,
  GRAMMAR_CUES, isUnitWord, lineFoods, MIN_QUOTE_TOKENS, messageOverlaps, numberUnitOverlaps, numberUnitPairs, OVERLAP_JACCARD_MAX,
  questionEcho, quotedPhrases, quoteOverlaps, refFoodOverlaps, type RefLineCase, STEM_LEN, type TextCase, tokenJaccard,
} from './overlap.ts';
import type { EvalFixture } from './types.ts';

const { fixtures } = await loadFixtureDir(new URL('./fixtures/', import.meta.url));
const isHoldout = (f: EvalFixture) => (f.tags ?? []).includes('holdout');
const fixtureTexts: TextCase[] = fixtures.map((f) => ({ id: f.id, text: f.message }));
const shotTexts: TextCase[] = UNDERSTAND_FEW_SHOTS.map((s) => ({ id: s.id, text: s.message }));

/** Every rendered ref line of a fixture TurnInput (records, constraints, holds, draft). */
function fixtureRefLines(f: EvalFixture): RefLineCase[] {
  const ti = f.turn_input;
  return [
    ...(ti.records ?? []).map((r) => ({ id: f.id, ref: r.ref, line: r.line })),
    ...(ti.spine ?? []).map((c) => ({ id: f.id, ref: c.ref, line: `${c.display_tr} ${c.subject_id}` })),
    ...(ti.pending ?? []).map((p) => ({ id: f.id, ref: p.ref, line: p.line })),
    ...(ti.draft ? [{ id: f.id, ref: ti.draft.ref, line: ti.draft.line }] : []),
  ];
}

Deno.test('overlap detector: folds ASCII Turkish, measures token Jaccard, finds contiguous runs', () => {
  assertEquals(foldTokens('Yok o yanlış, GERİ al!'), ['yok', 'o', 'yanlis', 'geri', 'al']);
  assertEquals(foldTokens('yok o yanlis, geri al'), foldTokens('yok o yanlış geri al'));
  assertEquals(tokenJaccard(['a', 'b'], ['a', 'b']), 1);
  assertEquals(tokenJaccard(['a', 'b'], ['b', 'c']), 1 / 3);
  assert(containsRun(['bugun', 'toplam', '2', 'litre'], ['toplam', '2']));
  assert(!containsRun(['bugun', 'toplam', '2', 'litre'], ['toplam', 'litre']));
  assertEquals(quotedPhrases('a ("x y z", "q") b "uzun bir örnek"'), ['x y z', 'q', 'uzun bir örnek']);
  assertEquals(contextRefLine('KAYITLAR: m14 · bugün öğle · kaşarlı tost ~390 kcal (son tur)'), { ref: 'm14', line: 'bugün öğle · kaşarlı tost ~390 kcal (son tur)' });
  assertEquals(contextRefLine('BUGÜN: su 1,40 L'), null);
  assertEquals([...lineFoods('bugün öğle · kaşarlı tost ~390 kcal (son tur)')].sort(), ['kasarli', 'tost']);
});

Deno.test('overlap detector catches the round-1 copies it was written for (self-test on the v4 examples)', () => {
  // v4 few-shots that mirrored fixtures (review 2026-10-10) — each must be caught.
  const v4: TextCase[] = [
    { id: 'su_gun_toplami@v4', text: 'bugün toplam 2 litre su içtim' },
    { id: 'su_geri_al@v4', text: 'yok o yanlış geri al' },
    { id: 'su_ekle@v4', text: 'çayın yanında 1 bardak su daha içtim' },
    { id: 'taslak_onayi@v4', text: 'onaylıyorum' },
    { id: 'alerji_beyani@v4', text: 'fıstık alerjim yok ama fındığa ciddi alerjim var' },
  ];
  const fx: TextCase[] = [
    { id: 'probe-cap-bugun-toplam-iki-litre', text: 'bugün toplam 2 litre su içtim' },
    { id: 'r3-final2-2-su-sonrasi-geri-al', text: 'yok o yanlis, geri al' },
    { id: 'probe-cap-bir-bardak-su-daha', text: '1 bardak su daha içtim' },
    { id: 'spec-a-taslak-acikken-onayliyorum', text: 'onaylıyorum' },
    { id: 'bplus-fistik-yok-ama-findik-var', text: 'fıstık alerjim yok ama fındık alerjim var' },
  ];
  const hits = messageOverlaps(v4, fx);
  for (const p of v4) assert(hits.some((h) => h.probe === p.id), `${p.id} not caught: ${JSON.stringify(hits)}`);
  // A quoted rule example equal to a fixture message, and one inside it, are caught; a grammar cue is not.
  const q = quoteOverlaps([{ id: 'rule2', text: 'kadın arkadaşımla yemeğe gittim' }, { id: 'rule6', text: 'bir muz daha' }, { id: 'rule1', text: 'içsem yeter mi' }], [
    { id: 'spec-aprime-kadin-arkadasimla-yemek', text: 'kadın arkadaşımla yemeğe gittim' },
    { id: 'spec-a-on-dakika-sonra-bir-muz-daha', text: 'bir muz daha yedim' },
    { id: 'r3-diff-3a', text: 'bugün 2 litre su içsem yeter mi?' },
  ]);
  assertEquals(q.map((h) => h.probe).sort(), ['rule2', 'rule6']);
  assert(GRAMMAR_CUES.includes('icsem yeter mi'));
  // v4 iki_aday_sil showed the fixture's own refs with the same foods.
  const rf = refFoodOverlaps(
    [{ id: 'iki_aday_sil@v4', ref: 'm14', line: 'bugün öğle · kaşarlı tost ~390 kcal (son tur)' }, { id: 'iki_aday_sil@v4', ref: 'd3', line: 'su +0,20 L (gün 1,00 L) (son tur)' }],
    [
      { id: 'spec-a-sonuncuyu-sil-iki-aday', ref: 'm14', line: 'Sal 6 Eki öğle 13:15 · "öğlen tost yedim ve 1 bardak su içtim" → kaşarlı tost 1 adet ~150 g 390 kcal [model]' },
      { id: 'spec-a-sonuncuyu-sil-iki-aday', ref: 'd3', line: 'su +0,20 L ("1 bardak su") → gün 1,0 L' },
      { id: 'other', ref: 'm14', line: 'bugün öğle · mercimek çorbası' },
    ],
  );
  assertEquals(rf.map((h) => `${h.probe}>${h.fixture}`).sort(), ['iki_aday_sil@v4:d3>spec-a-sonuncuyu-sil-iki-aday', 'iki_aday_sil@v4:m14>spec-a-sonuncuyu-sil-iki-aday']);
});

Deno.test('overlap detector (round 3): content words by stem and number+word pairs catch the paraphrases Jaccard missed', () => {
  // Inflections fold onto one stem; log verbs are not content. Since round 4 "alerji"/"ciddi" are.
  assertEquals(STEM_LEN, 5);
  assertEquals([...contentStems('fıstık alerjim yok ama fındığa ciddi alerjim var')].sort(), ['alerj', 'ciddi', 'findi', 'fisti']);
  assertEquals([...numberUnitPairs('yanlış olmuş, 2 değil 1 tabak makarna yedim')].sort(), ['1 tabak', '2 degil']);
  assertEquals([...numberUnitPairs('saat 8')], [], 'a number with nothing after it pairs with nothing');
  // v5 examples the review of tuning round 2 flagged — each is caught now (Jaccard let them through).
  const v5: TextCase[] = [
    { id: 'kucuk_miktar@v5', text: 'öğlen 2 dilim hellim yedim, üstüne bir tutam kekik' },
    { id: 'ref_ile_duzeltme@v5', text: 'yanlış olmuş, 2 değil 1 tabak makarna yedim' },
    { id: 'tetik_gercek@v5', text: 'sabah antrenmanda bir an bayıldım, şimdi iyiyim ama başım hâlâ dönüyor' },
    { id: 'alerji_beyani@v4', text: 'fıstık alerjim yok ama fındığa ciddi alerjim var' },
    { id: 'kayit_duzelt@capabilities-v5', text: '6 nugget için 1708 kcal' },
    { id: 'adim_sayisi@doc-v5', text: 'her gün 8 bin adımı hedefliyorum' },
  ];
  const fx: TextCase[] = [
    { id: 'r3-final2-5-iki-dilim-lahmacun-ayran', text: 'dün akşam 2 dilim lahmacun yedim yanında da 1 ayran içtim' },
    { id: 'ho-ref-ile-porsiyon-duzeltme', text: 'karnıyarık 2 değil tek porsiyondu, düzeltir misin' },
    { id: 'ho-merdivende-nefes-darligi', text: 'merdiven çıkarken nefesim daraldı, 10 dakikadır geçmiyor, başım da dönüyor' },
    { id: 'bplus-fistik-yok-ama-findik-var', text: 'fıstık alerjim yok ama fındık alerjim var' },
    { id: 'owner-nugget-onay', text: 'evet düzelt, normal boy 6 nuggetti' },
    { id: 'spec-aprime-gunde-on-bin-adim-hedefim', text: 'günde 10 bin adım hedefim var' },
  ];
  assertEquals(messageOverlaps(v5, fx).filter((h) => h.probe !== 'alerji_beyani@v4'), [], 'Jaccard alone misses them (the v4 copy aside)');
  const caught = new Set([...contentOverlaps(v5, fx), ...numberUnitOverlaps(v5, fx)].map((h) => h.probe));
  for (const p of v5) assert(caught.has(p.id), `${p.id} not caught`);
  // One shared food is vocabulary, not a case.
  assertEquals(contentOverlaps([{ id: 'p', text: 'akşam bir kase yoğurt yedim' }], [{ id: 'f', text: 'öğlen yoğurtlu makarna' }]), []);
  assertEquals(CONTENT_SHARED_MAX, 1);
  // Capability asides and quotes are extracted as examples.
  assertEquals(capabilityExamples('- Kaydı düzelt: düzeltmek (ör. küçük bir porsiyona binlerce kcal). - Hedef: ("3 ayda 5 kilo")'), ['küçük bir porsiyona binlerce kcal', '3 ayda 5 kilo']);
});

Deno.test('overlap detector (round 4): spelled numerals pair with units, the hotspot words count, an echoing tripwire question is caught', () => {
  // A spelled numeral pairs as its digit — next to a unit (inflected, softened) or "değil" only.
  assertEquals([...numberUnitPairs('dün iki dilim pide yedim')], ['2 dilim']);
  assertEquals([...numberUnitPairs('karnıyarık 2 değil tek porsiyondu')].sort(), ['1 porsi', '2 degil']);
  assertEquals([...numberUnitPairs('yarım litre su, üç bardağı da ayran')].sort(), ['0.5 litre', '3 barda']);
  assertEquals([...numberUnitPairs('bir tabağı bitirdim, iki değil')].sort(), ['1 tabag', '2 degil']);
  // …but not where the word has its everyday meaning: the article, "only", "under", "ate", "ön".
  assertEquals([...numberUnitPairs('bir an durdum, tek istediğim bu, masanın altı, o yedi, on bacak')], []);
  assert(isUnitWord('kasigi') && isUnitWord('porsiyondu') && isUnitWord('kez') && !isUnitWord('an') && !isUnitWord('sey'), 'folded tokens');
  // The same amount in two spellings is one pair: the round-3 guard missed this shape.
  const word = numberUnitOverlaps([{ id: 'ornek', text: 'akşam iki dilim kek yedim' }], [{ id: 'fixture', text: 'dün 2 dilim lahmacun yedim' }]);
  assertEquals(word.map((h) => h.why), ['ortak sayı+birim: 2 dilim']);
  // "dilim", "ciddi", "alerji" are content now: two of them (or one + a food) are a shared case.
  assertEquals([...CONTENT_WORDS_KEPT], ['dilim', 'ciddi', 'alerji']);
  assert(contentStems('4 dilim krep').has('dilim'));
  const v6shot: TextCase = { id: 'alerji_beyani@v6', text: 'hardala ciddi alerjim var, kereviz ise bana hiç dokunmuyor' };
  const allergyFixture: TextCase = { id: 'r3-mem-1a', text: 'fistiga alerjim var, ciddi. yanlislikla yersem nefesim daraliyor' };
  assertEquals(contentOverlaps([v6shot], [allergyFixture]).map((h) => h.why), ['ortak içerik kelimeleri: ciddi, alerj']);
  // A tripwire question that describes the fixture it fires on (the 2026-10-11 yutamıyorum wording)
  // is caught beyond the trigger word itself; a question naming only the two readings is not.
  const v6q = 'Bir belirti mi (boğazda şişme, takılma, hiçbir şeyi yutamama), yoksa yemeğin dokusu, miktarı ya da tadı yüzünden mi?';
  const bplus = 'kahvaltıdan beri boğazımda bir şey takılı kaldı, tükürüğümü bile yutamıyorum';
  assertEquals(questionEcho(v6q, 'yutamıyorum', bplus).sort(), ['bogaz', 'takil']);
  assertEquals(questionEcho('Gerçek bir yutma güçlüğü mü, yoksa sıradan bir yakınma mı?', 'yutamıyorum', bplus), []);
});

Deno.test('few-shot messages are not copies of any fixture message (Jaccard ≤ 0.6, no fixture inside)', () => {
  assertEquals(OVERLAP_JACCARD_MAX, 0.6);
  assertEquals(messageOverlaps(shotTexts, fixtureTexts), []);
});

Deno.test('few-shot messages share at most one content word and no number+word pair with any fixture message (holdout included)', () => {
  assertEquals(contentOverlaps(shotTexts, fixtureTexts), []);
  assertEquals(numberUnitOverlaps(shotTexts, fixtureTexts), []);
});

Deno.test('few-shot context lines share at most one content word with ANY fixture ref/reference line, whatever the ref', () => {
  const ctx: TextCase[] = UNDERSTAND_FEW_SHOTS.flatMap((s) => s.context.map((l, i) => ({ id: `${s.id}#${i}`, text: l.slice(l.indexOf(': ') + 2) })));
  assert(ctx.length >= 12, 'the context lines are read');
  const lines: TextCase[] = fixtures.flatMap((f) => [
    ...fixtureRefLines(f).map((r) => ({ id: `${f.id}:${r.ref}`, text: r.line })),
    ...(f.turn_input.reference_candidates ?? []).map((c) => ({ id: `${f.id}:${c.key}`, text: c.line })),
  ]);
  assertEquals(contentOverlaps(ctx, lines), []);
});

Deno.test('few-shot context never reuses a fixture\'s exact ref with the same food/subject', () => {
  const shots: RefLineCase[] = [];
  for (const s of UNDERSTAND_FEW_SHOTS) {
    for (const line of s.context) {
      const r = contextRefLine(line);
      if (r) shots.push({ id: s.id, ...r });
    }
  }
  assert(shots.length >= 8, 'the record/hold/draft context lines are parsed');
  assertEquals(refFoodOverlaps(shots, fixtures.flatMap(fixtureRefLines)), []);
});

Deno.test('quoted examples in the rules and the registry doc are not copies of fixture messages (grammar cues aside)', () => {
  const quotes: TextCase[] = [
    ...quotedPhrases(UNDERSTAND_RULES).map((t, i) => ({ id: `kural#${i}: ${t}`, text: t })),
    ...quotedPhrases(buildWriteDoc()).map((t, i) => ({ id: `belge#${i}: ${t}`, text: t })),
  ];
  assert(quotes.length >= 20, 'the prefix quotes examples');
  assertEquals(quoteOverlaps(quotes, fixtureTexts), []);
  // Round 3: an example (≥ 3 tokens; shorter quotes are words like "2 çimdik") keeps no fixture's case either.
  const examples = quotes.filter((q) => foldTokens(q.text).length >= MIN_QUOTE_TOKENS);
  assertEquals(contentOverlaps(examples, fixtureTexts), []);
  assertEquals(numberUnitOverlaps(examples, fixtureTexts), []);
});

Deno.test('the coach\'s capability text (Stage B) quotes no fixture case (review of tuning round 2: the nugget aside)', () => {
  const examples: TextCase[] = capabilityExamples(buildCapabilities()).map((t, i) => ({ id: `yetenek#${i}: ${t}`, text: t }));
  assert(examples.length >= 5, 'capability examples are read');
  assertEquals(quoteOverlaps(examples, fixtureTexts), []);
  assertEquals(contentOverlaps(examples, fixtureTexts), []);
  assertEquals(numberUnitOverlaps(examples, fixtureTexts), []);
});

Deno.test('tripwire questions Stage A reads (curated and v1-floor) quote no fixture and do not describe the fixture they fire on', () => {
  // Every question a hit can carry: curated, signal, the v1 floor lists, and narrated occurrences.
  const defs: readonly TripwireDef[] = [...EXPLICIT_TRIPWIRES, ...AMBIGUOUS_TRIPWIRES, ...SIGNAL_TRIPWIRES, ...V1_FLOOR_TRIPWIRES, ...V1_AMBIGUOUS_FLOOR_TRIPWIRES];
  const questions: TextCase[] = [...new Set(defs.flatMap((d) => [d.question_tr, ...(d.narration_q ? [d.narration_q] : [])]))].map((t) => ({ id: `soru: ${t}`, text: t }));
  assert(questions.length >= 30, `the questions are read (${questions.length})`);
  assertEquals(messageOverlaps(questions, fixtureTexts), []);
  const quotes: TextCase[] = questions.flatMap((q) => quotedPhrases(q.text).map((t) => ({ id: q.id, text: t })));
  assertEquals(quoteOverlaps(quotes, fixtureTexts), []);
  // On the turn it fires: beyond the trigger words, at most one shared content word, no shared amount.
  const echoes: string[] = [];
  let facts = 0;
  for (const f of fixtures) {
    for (const x of tripwireFacts(scanTripwires(f.message))) {
      facts++;
      const shared = questionEcho(x.question_tr, x.matched, f.message);
      if (shared.length > CONTENT_SHARED_MAX) echoes.push(`${f.id} ${x.trigger}: ${shared.join(', ')}`);
      const pairs = [...numberUnitPairs(x.question_tr)].filter((p) => numberUnitPairs(f.message).has(p));
      if (pairs.length) echoes.push(`${f.id} ${x.trigger}: ${pairs.join(', ')}`);
    }
  }
  assert(facts >= 30, `tripwire facts on the fixtures are read (${facts})`);
  assertEquals(echoes, []);
});

Deno.test('holdout set: ~25 fresh cases, tagged, spanning the review\'s categories — no near-copy of tuning fixtures or prompt examples', () => {
  const holdout = fixtures.filter(isHoldout);
  assert(holdout.length >= 24, `only ${holdout.length} holdout fixtures`);
  for (const f of holdout) assert(f.source.startsWith('holdout:'), `${f.id}: holdout source`);
  for (const pkg of ['A', "A'", 'B+', 'B-']) assert(holdout.some((f) => f.package === pkg), `holdout has no ${pkg} case`);
  const tuning = fixtures.filter((f) => !isHoldout(f)).map((f) => ({ id: f.id, text: f.message }));
  const ho = holdout.map((f) => ({ id: f.id, text: f.message }));
  assertEquals(messageOverlaps(ho, tuning), [], 'holdout wording must be fresh against the tuning fixtures');
  assertEquals(messageOverlaps(ho, shotTexts), [], 'holdout wording must be fresh against the few-shots');
  assertEquals(messageOverlaps(shotTexts, ho), []);
});
