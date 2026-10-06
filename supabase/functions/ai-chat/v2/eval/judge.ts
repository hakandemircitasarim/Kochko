/**
 * Luna judge over the same transport (so judge calls are cached and replayable like Stage A).
 * Used for `claims_subset_of_receipts` / `answers_user_question` (§9.4 C machine checks).
 * Fails CLOSED: a missing, refused or malformed verdict is a failed rubric item, never a pass.
 */
import { buildJudgeRequest, type JudgePort, parseJudgeVerdicts } from './rubric.ts';
import { type LlmTransport, parseDecision } from './transport.ts';
import { rawPayload } from './request.ts';
import { requestKey } from './replay-store.ts';

export const DEFAULT_JUDGE_MODEL = 'gpt-6-luna';

export function transportJudge(transport: LlmTransport, model = DEFAULT_JUDGE_MODEL): JudgePort {
  return {
    async judge(input) {
      const payload = rawPayload(buildJudgeRequest(input, model));
      const key = await requestKey(payload);
      const { response, cache } = await transport.call({ fixture_id: `judge:${input.fixture_id}`, rep: 0, payload, key });
      if (cache === 'miss') throw new Error('yargıç için replay kaydı yok');
      if (!response.ok && !response.refusal) throw new Error(response.error ?? 'yargıç çağrısı başarısız');
      const parsed = parseDecision(response);
      if (parsed.error) throw new Error(parsed.error);
      return parseJudgeVerdicts(parsed.decision, input.rubric);
    },
  };
}
