/**
 * write-registry/capabilities.ts — "bu uygulamada gerçekten yapabildiklerin" for the coach
 * (AI_MIMARI_V2 §4.1, §8.2.3). Generated from the registry so the coach's promises come from the
 * same source as the writes: hollow claims ("hedefleri zorlaştırıyorum", "%10 düşürdüm") have no
 * op to point at, and the list says so.
 */
import { REGISTRY } from './registry.ts';

/** Abbreviations whose dot does not end a sentence. */
const ABBREV = /(?:^|\s|\()(?:vb|vs|ör|örn|bkz|yak)$/u;

/** The first sentence, not fooled by "vb." or "ör.". */
export function firstSentence(s: string): string {
  const re = /[.!?](?=\s|$)/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (!ABBREV.test(s.slice(0, m.index))) return s.slice(0, m.index + 1);
  }
  return s;
}

export function buildCapabilities(): string {
  const lines = ['BU UYGULAMADA GERÇEKTEN YAPABİLDİKLERİN (kayıtlar yalnızca bu yollarla değişir):'];
  for (const o of REGISTRY) {
    if (o.channel === 'pending_ops') continue;
    const held = o.hold_tr || o.rule_docs.ask.length > 0 ? ' Gerekirse önce kullanıcıya sorulur.' : '';
    lines.push(`- ${o.title_tr}: ${o.capability_tr ?? firstSentence(o.when_tr)}${held}`);
  }
  lines.push('- Plan: taslak üretmek, revize etmek, açıklamak; kullanıcı onaylayınca uygulamak.');
  lines.push('Burada olmayan bir değişikliği yaptığını ya da yapacağını söyleme. Bir yazma bekletildiyse ya da reddedildiyse bunu dürüstçe söyle; kaydı yapılmış gibi anlatma.');
  return lines.join('\n');
}
