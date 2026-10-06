/**
 * Human-readable Turkish report. The JSON report (--out) is the machine artifact; this is what a
 * person reads after a run: gates first, then every failing fixture with its failing checks.
 */
import type { EvalReport, FixtureRunResult, GateResult } from './types.ts';

const ICON: Record<GateResult['status'], string> = { pass: 'GEÇTİ', fail: 'KALDI', no_data: 'VERİ YOK', incomplete: 'EKSİK' };

function failingLines(r: FixtureRunResult): string[] {
  const lines = r.outcomes.filter((o) => o.status === 'fail').map((o) => `      ✗ ${o.label}\n        → ${o.detail}`);
  for (const rb of r.rubric.filter((x) => x.status === 'fail')) lines.push(`      ✗ rubrik ${rb.rubric} (${rb.by}) → ${rb.detail}`);
  if (r.parse_error) lines.push(`      ✗ ayrıştırma: ${r.parse_error}`);
  if (r.schema_errors?.length) lines.push(`      ! şema: ${r.schema_errors.slice(0, 3).join(' | ')}`);
  return lines;
}

export function formatReport(rep: EvalReport, opts: { verbose?: boolean } = {}): string {
  const out: string[] = [];
  out.push(`KOCHKO v2 eval — kip ${rep.mode} · model ${rep.model} · effort ${rep.effort} · ${rep.fixture_count} fixture × ${rep.reps} tekrar`);
  const t = rep.totals;
  out.push(`Sonuç: ${t.pass} geçti · ${t.fail} kaldı · ${t.skipped} atlandı · ${t.error} hata${t.cache_miss ? ` · ${t.cache_miss} replay kaydı yok` : ''}`);
  if (rep.latency.samples) out.push(`Stage A gecikme: p50 ${rep.latency.p50_ms} ms · p90 ${rep.latency.p90_ms} ms (${rep.latency.samples} ölçüm)`);
  if (rep.cost_usd_estimate !== null) out.push(`Tahmini maliyet: $${rep.cost_usd_estimate}`);
  out.push('');
  out.push('KAPILAR (§9.4):');
  for (const g of rep.gates) out.push(`  [${ICON[g.status]}] ${g.package.padEnd(2)} ${g.label_tr} — ${g.detail}`);

  const failed = rep.results.filter((r) => r.status === 'fail');
  if (failed.length) {
    out.push('');
    out.push('KALAN FIXTURE\'LAR:');
    for (const r of failed) {
      out.push(`  ${r.fixture_id} [${r.package}] tekrar ${r.rep} (${r.source})`);
      out.push(...failingLines(r));
    }
  }
  const errors = rep.results.filter((r) => r.status === 'error');
  if (errors.length) {
    out.push('');
    out.push('HATALAR (model davranışı değil, altyapı):');
    for (const r of errors.slice(0, 20)) out.push(`  ${r.fixture_id} tekrar ${r.rep}: ${r.error}`);
  }
  if (opts.verbose) {
    const skipped = rep.results.filter((r) => r.status === 'skipped');
    const reasons = new Map<string, number>();
    for (const r of skipped) reasons.set(r.skip_reason ?? '?', (reasons.get(r.skip_reason ?? '?') ?? 0) + 1);
    if (reasons.size) {
      out.push('');
      out.push('ATLANANLAR:');
      for (const [why, n] of reasons) out.push(`  ${n} × ${why}`);
    }
  }
  return out.join('\n');
}
