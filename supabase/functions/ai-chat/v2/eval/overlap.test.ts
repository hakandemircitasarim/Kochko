/**
 * Teaching-to-the-test guard (2026-10-11 review of tuning round 1): no few-shot, rule example or
 * registry-doc example may be a copy of an eval fixture — otherwise that fixture grades recall of
 * the example, not understanding. The holdout set (tag 'holdout') must also be fresh wording: no
 * near-copy of any tuning fixture or prompt example.
 */
import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { buildWriteDoc } from '../../../shared/write-registry/mod.ts';
import { UNDERSTAND_FEW_SHOTS, UNDERSTAND_RULES } from '../understand-prompt.ts';
import { loadFixtureDir } from './fixtures.ts';
import {
  containsRun, contextRefLine, foldTokens, GRAMMAR_CUES, lineFoods, messageOverlaps, OVERLAP_JACCARD_MAX, quotedPhrases, quoteOverlaps,
  refFoodOverlaps, type RefLineCase, type TextCase, tokenJaccard,
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

Deno.test('few-shot messages are not copies of any fixture message (Jaccard ≤ 0.6, no fixture inside)', () => {
  assertEquals(OVERLAP_JACCARD_MAX, 0.6);
  assertEquals(messageOverlaps(shotTexts, fixtureTexts), []);
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
