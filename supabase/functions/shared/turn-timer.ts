/**
 * turn-timer.ts — where did this turn's wall-clock go?
 *
 * WHY: ai_turn_log.latency_ms only times the LLM call. Measured 2026-10-04, a 15 s chat turn spent
 * 4.6 s in the model and 10.5 s everywhere else (database round-trips crossing Frankfurt↔Singapore).
 * Nothing in the ledger could show that. Each phase boundary calls mark(); the summary rides out on
 * the `x-kochko-timings` response header and one `[timing]` log line, so a probe or the function
 * logs can attribute every second without a schema change.
 */
export interface TurnTimer {
  mark(label: string): void;
  total(): number;
  summary(): string;
}

export function createTurnTimer(): TurnTimer {
  const t0 = performance.now();
  let last = t0;
  const marks: string[] = [];
  return {
    mark(label: string) {
      const now = performance.now();
      marks.push(`${label}=${Math.round(now - last)}`);
      last = now;
    },
    total() {
      return Math.round(performance.now() - t0);
    },
    summary() {
      return [...marks, `total=${Math.round(performance.now() - t0)}`].join(';');
    },
  };
}
