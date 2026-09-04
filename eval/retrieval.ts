import { CLASSIC_TOP_K } from '../lib/agent';
import { filterCandidates, getCv, searchCvs } from '../lib/tools';
import { score, type EvalQuestion, type Score } from './questions';

/**
 * Tier 1 — the retrieval ceiling.
 *
 * The central claim of this project is that classic top-k retrieval
 * *structurally* cannot answer an aggregation question: the correct answer is a
 * set of 19 candidates and k is a hard cap on how many can come back. That is a
 * property of the retrieval layer, not of the model's prose, so it is measured
 * here with no LLM in the loop at all.
 *
 * Both arms are given their best case. Classic gets the same top-k search the
 * app's classic mode runs; agentic gets the tool call that ideally answers the
 * question, taken from the oracle rather than chosen by a model. So this
 * measures what each architecture *can* reach, independent of whether a given
 * model routes correctly on a given day — which makes the gap attributable to
 * the architecture and nothing else.
 *
 * Costs one query embedding per question and no chat requests, which is what
 * lets the full question set run on a free-tier key.
 */

export interface RetrievalArm {
  ids: string[];
  score: Score;
  detail: string;
}

export interface RetrievalMeasurement {
  question: EvalQuestion;
  classic: RetrievalArm;
  agentic: RetrievalArm;
}

/** Distinct candidates reachable from a classic top-k chunk retrieval. */
async function classicArm(question: EvalQuestion): Promise<RetrievalArm> {
  const { hits } = await searchCvs({ query: question.question, top_k: CLASSIC_TOP_K });
  const ids = [...new Set(hits.map((hit) => hit.candidate_id))].sort();
  return {
    ids,
    score: score(question.expected, ids),
    detail: `top-${CLASSIC_TOP_K} → ${hits.length} chunks, ${ids.length} distinct candidates`,
  };
}

/** Candidates reachable from the tool call that ideally answers the question. */
function agenticArm(question: EvalQuestion): RetrievalArm {
  if (question.ideal.tool === 'get_cv') {
    const result = getCv(question.ideal.input);
    const ids = 'error' in result ? [] : [result.candidate.id];
    return { ids, score: score(question.expected, ids), detail: `get_cv(${question.ideal.input.candidate_id})` };
  }

  const result = filterCandidates(question.ideal.input);
  const ids = result.candidates.map((candidate) => candidate.candidate_id).sort();
  const args = Object.entries(question.ideal.input)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');
  return {
    ids,
    score: score(question.expected, ids),
    detail: `filter_candidates(${args}) → ${result.total} matches, complete=${result.complete}`,
  };
}

export async function measureRetrieval(question: EvalQuestion): Promise<RetrievalMeasurement> {
  return { question, classic: await classicArm(question), agentic: agenticArm(question) };
}
