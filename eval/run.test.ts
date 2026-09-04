import { afterAll, describe, expect, it } from 'vitest';
import { answerQuestion } from '../lib/agent';
import { CLASSIC_TOP_K } from '../lib/agent';
import { indexExists } from '../lib/stores';
import { hasApiKey } from '../lib/llm';
import { measureRetrieval, type RetrievalMeasurement } from './retrieval';
import { buildQuestions, loadGroundTruth, score, type EvalQuestion, type Score } from './questions';
import type { ChatMode } from '../lib/schemas';

/**
 * Agentic vs classic RAG, measured (PRD §12).
 *
 * Two tiers, because they answer different questions:
 *
 *   1. RETRIEVAL — what each architecture *can* reach. Deterministic, no chat
 *      model, one embedding per question. This is where the structural claim
 *      lives: top-k caps recall at k no matter which model reads the chunks.
 *
 *   2. END-TO-END — whether the model actually gets there through the real chat
 *      path. Costs several chat requests per question, so it runs on a subset by
 *      default and is skipped entirely when no key is configured.
 *
 * Splitting them matters methodologically as well as practically: tier 1 removes
 * model variance from the headline number, so the gap is attributable to the
 * architecture rather than to whichever model happened to answer that day.
 *
 *   npm run eval                    # retrieval + a 2-question end-to-end sample
 *   EVAL_E2E=0 npm run eval         # retrieval only, zero chat requests
 *   EVAL_E2E=13 npm run eval        # full end-to-end (needs generous quota)
 */

const E2E_COUNT = Number(process.env.EVAL_E2E ?? 2);
const MODES: ChatMode[] = ['agentic', 'classic'];

const indexed = indexExists();
const questions = indexed ? buildQuestions() : [];

const retrieval: RetrievalMeasurement[] = [];
const endToEnd: { question: EvalQuestion; mode: ChatMode; score: Score; cited: string[]; text: string }[] = [];

describe.skipIf(!indexed)('retrieval ceiling (no chat model)', () => {
  it('derives its questions from ground truth', () => {
    const corpus = loadGroundTruth();
    expect(corpus.length).toBeGreaterThanOrEqual(25);
    expect(questions.length).toBeGreaterThanOrEqual(10);
    for (const shape of ['aggregation', 'exact-filter', 'document', 'multi-constraint', 'negative'] as const) {
      expect(questions.some((q) => q.shape === shape), `missing shape: ${shape}`).toBe(true);
    }
  });

  for (const question of questions) {
    it(`${question.id}: ${question.question}`, { timeout: 120_000 }, async () => {
      const measurement = await measureRetrieval(question);
      retrieval.push(measurement);

      // The agentic retriever is asserted; classic is the baseline being
      // measured, and failing the suite because the baseline is bad would
      // defeat the point of running it.
      expect(
        measurement.agentic.score.recall,
        `agentic retrieval missed candidates. got=${measurement.agentic.ids.join(',')} expected=${question.expected.join(',')}`,
      ).toBe(1);
      expect(measurement.agentic.score.precision, 'agentic retrieval returned non-matches').toBe(1);
    });
  }
});

const e2eQuestions = questions.slice(0, Math.max(0, E2E_COUNT));
const runE2E = indexed && hasApiKey() && e2eQuestions.length > 0;

describe.skipIf(!runE2E)('end-to-end through the chat path', () => {
  for (const mode of MODES) {
    for (const question of e2eQuestions) {
      it(`${mode} · ${question.id}`, { timeout: 300_000 }, async () => {
        const answer = await answerQuestion(question.question, mode);
        const result = score(question.expected, answer.citedIds);
        endToEnd.push({ question, mode, score: result, cited: answer.citedIds, text: answer.text });

        if (mode === 'agentic') {
          if (question.shape === 'negative') {
            expect(answer.citedIds, `hallucinated: ${answer.text.slice(0, 200)}`).toEqual([]);
          } else {
            expect(
              result.recall,
              `recall too low. cited=${answer.citedIds.join(',')} expected=${question.expected.join(',')}`,
            ).toBeGreaterThanOrEqual(0.9);
          }
        }
      });
    }
  }
});

/* ---------------------------------------------------------------- report --- */

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`.padStart(4);
}

afterAll(() => {
  if (!indexed) {
    console.log('\n  eval skipped — no index. Run `npm run ingest`.\n');
    return;
  }
  if (retrieval.length === 0) return;

  const rule = '─'.repeat(94);
  console.log(`\n${rule}`);
  console.log(`  RETRIEVAL CEILING — ${retrieval.length} questions derived from ground truth, no chat model`);
  console.log(rule);
  console.log(`  ${'question'.padEnd(44)} ${'shape'.padEnd(16)} ${'agentic P/R'.padEnd(14)} classic P/R`);
  console.log(`  ${'─'.repeat(44)} ${'─'.repeat(16)} ${'─'.repeat(14)} ${'─'.repeat(13)}`);

  for (const row of retrieval) {
    const label =
      row.question.question.length > 43
        ? `${row.question.question.slice(0, 40)}...`
        : row.question.question;
    console.log(
      `  ${label.padEnd(44)} ${row.question.shape.padEnd(16)} ` +
        `${`${pct(row.agentic.score.precision)} /${pct(row.agentic.score.recall)}`.padEnd(14)} ` +
        `${pct(row.classic.score.precision)} /${pct(row.classic.score.recall)}`,
    );
  }

  console.log(`  ${'─'.repeat(94)}`);
  for (const [label, arm] of [
    ['agentic (tool-routed)', 'agentic'],
    [`classic  (top-${CLASSIC_TOP_K})`, 'classic'],
  ] as const) {
    const rows = retrieval.map((r) => r[arm]);
    console.log(
      `  ${label.padEnd(44)} ${''.padEnd(16)} precision ${pct(mean(rows.map((r) => r.score.precision)))}` +
        `   recall ${pct(mean(rows.map((r) => r.score.recall)))}` +
        `   F1 ${pct(mean(rows.map((r) => r.score.f1)))}`,
    );
  }

  const aggregation = retrieval.filter((r) => r.question.shape === 'aggregation');
  if (aggregation.length) {
    console.log(`\n  Aggregation questions — the shape top-k structurally cannot answer:`);
    for (const row of aggregation) {
      console.log(
        `    ${row.question.question.padEnd(52)} ` +
          `agentic ${String(row.agentic.ids.length).padStart(2)}/${row.question.expected.length}` +
          `   classic ${String(row.classic.ids.length).padStart(2)}/${row.question.expected.length}`,
      );
    }
    console.log(
      `    recall  agentic ${pct(mean(aggregation.map((r) => r.agentic.score.recall)))}` +
        `   vs   classic ${pct(mean(aggregation.map((r) => r.classic.score.recall)))}`,
    );
  }

  if (endToEnd.length > 0) {
    console.log(`\n${rule}`);
    console.log(`  END-TO-END — ${e2eQuestions.length} question(s) through the real chat path`);
    console.log(rule);
    for (const mode of MODES) {
      const rows = endToEnd.filter((r) => r.mode === mode);
      if (rows.length === 0) continue;
      console.log(
        `  ${mode.padEnd(44)} precision ${pct(mean(rows.map((r) => r.score.precision)))}` +
          `   recall ${pct(mean(rows.map((r) => r.score.recall)))}`,
      );
      for (const row of rows) {
        console.log(`    ${row.question.id.padEnd(20)} cited ${String(row.cited.length).padStart(2)}/${row.question.expected.length}`);
      }
    }
    console.log(`\n  (raise with EVAL_E2E=<n>; the free tier allows 20 chat requests per day per model)`);
  } else if (hasApiKey()) {
    console.log(`\n  end-to-end tier skipped — set EVAL_E2E=<n> to run it.`);
  } else {
    console.log(`\n  end-to-end tier skipped — no GOOGLE_GENERATIVE_AI_API_KEY.`);
  }
  console.log(`${rule}\n`);
});
