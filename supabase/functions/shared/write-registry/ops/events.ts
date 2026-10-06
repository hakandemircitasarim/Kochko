/**
 * Life events, lab values, recipes (map-writes #30, #31, #32).
 *
 * life_event: the model resolves "3 hafta sonra" to a date from the local day it was given; no
 * regex date parser, no silent ±10-day dedupe (a correction uses `replaces`).
 * lab_value: a nullable value + typed status instead of the sentinel 0 that made qualitative
 * results ("D vitaminim düşük") invisible to the coach; reference ranges carry their source.
 * recipe_save: SMALLINT totals are rounded at the boundary (no more 22P02 on "32,5 g protein").
 */
import { f, op, rule } from '../dsl.ts';
import { LAB_STATUS, LIFE_EVENT_TYPES, RECIPE_CATEGORIES } from '../vocab.ts';

export const life_event = op({
  type: 'life_event',
  channel: 'writes',
  envelope: 'life_event',
  title_tr: 'Yaklaşan olay',
  when_tr: 'İleri tarihli, motive eden bir olay ("3 hafta sonra kardeşimin düğünü").',
  not_when_tr: 'geçmiş ya da tarihsiz olaylar.',
  fields: {
    title: f.text({ max: 80 }),
    event_type: f.enum(LIFE_EVENT_TYPES),
    event_date: f.date({ past_days: 0, future_days: 730 }),
    note: f.text({ nullable: true, max: 200 }),
    replaces: f.ref(['e'], { nullable: true }),
  },
  writes: { rpc: 'w_life_event_apply', tables: ['life_events', 'turn_writes'], undo: 'soft_delete' },
  invariants: ['countdown_context'],
});

export const lab_value = op({
  type: 'lab_value',
  channel: 'writes',
  envelope: 'lab_value',
  title_tr: 'Tahlil sonucu',
  when_tr: 'Tahlil sonuçları (sayılı ya da "D vitaminim düşük çıktı").',
  fields: {
    measured_at: f.date({ nullable: true, past_days: 3650, future_days: 0 }),
    items: f.list({ min: 1, max: 30 }, {
      parameter: f.text({ max: 40, tr: 'snake_case (d_vitamini, b12, ferritin…)' }),
      value: f.num({ nullable: true, hard: [0, 100000], tr: 'sayı yoksa null' }),
      unit: f.text({ nullable: true, max: 20 }),
      status: f.enum(LAB_STATUS),
      reference_min: f.num({ nullable: true }),
      reference_max: f.num({ nullable: true }),
      reference_source: f.enum({ report: 'rapordaki aralık', typical: 'genel bilinen aralık' }, { nullable: true }),
      note: f.text({ nullable: true, max: 300 }),
    }),
  },
  writes: { rpc: 'w_lab_apply', tables: ['lab_values', 'turn_writes'], undo: 'soft_delete' },
  tier: 'rare',
}).rules({
  hard: [
    rule('bos_tahlil', 'her kalemde değer, durum (unknown dışı) ya da not olmalı', (a) =>
      a.items.some((it) => it.value === null && it.status === 'unknown' && it.note === null),
      { repairable: true, failure_class: 'missing_field' }),
  ],
});

export const recipe_save = op({
  type: 'recipe_save',
  channel: 'writes',
  envelope: 'save_recipe',
  title_tr: 'Tarif',
  when_tr: 'Bir tarifi kaydetme isteği.',
  fields: {
    title: f.text({ max: 120 }),
    category: f.enum(RECIPE_CATEGORIES),
    ingredients: f.list({ min: 1, max: 40 }, {
      name: f.text({ max: 60 }),
      as_stated: f.text({ max: 60 }),
    }),
    instructions: f.text({ max: 3000 }),
    kcal: f.num({ unit: 'kcal', nullable: true, hard: [0, 10000], decimals: 0, tr: 'porsiyon başına' }),
    protein_g: f.num({ unit: 'g', nullable: true, hard: [0, 500], decimals: 0 }),
    prep_time_min: f.num({ unit: 'dk', nullable: true, hard: [0, 1440], decimals: 0 }),
    servings: f.num({ nullable: true, hard: [1, 50], decimals: 0 }),
  },
  writes: { rpc: 'w_recipe_apply', tables: ['saved_recipes', 'turn_writes'], undo: 'none' },
  tier: 'rare',
});
