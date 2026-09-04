import { afterAll, describe, expect, it } from 'vitest';
import { answerQuestion } from '../lib/agent';
import { indexExists } from '../lib/stores';
import { hasApiKey } from '../lib/llm';
import { buildQuestions, loadGroundTruth, score, type EvalQuestion, type Score } from './questions';
import type { ChatMode } from '../lib/schemas';

/**
 * Agentic vs classic RAG, measured (PRD §12).
 *
 * The headline claim of this project is that tool-routed retrieval answers
 * questions that top-k retrieval structurally cannot. This file is what turns
 * that from an architectural assertion into a number, using ground truth we get
 * for free because we generated the corpus.
 *
 *   npm run eval
 */

const MODES: ChatMode[] = ['agentic', 'classic'];

interface Row {
  question: EvalQuestion;
  mode: ChatMode;
  score: Score;
  cited: string[];
  tools: string[];
  text: string;
}

const rows: Row[] = [];

const ready = indexExists() && hasApiKey();
const questions = ready ? buildQuestions() : [];

describe.skipIf(!ready)('agentic vs classic RAG', () => {
  const corpus = ready ? loadGroundTruth() : [];

  it('derives its questions from ground truth', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(25);
    expect(questions.length).toBeGreaterThanOrEqual(10);
    // Every shape from PRD §1 and §12 must be represented.
    for (const shape of ['aggregation', 'exact-filter', 'document', 'multi-constraint', 'negative'] as const) {
      expect(questions.some((q) => q.shape === shape), `missing shape: ${shape}`).toBe(true);
    }
  });

  for (const mode of MODES) {
    describe(mode, () => {
      for (const question of questions) {
        it(
          `${question.id}: ${question.question}`,
          { timeout: 180_000 },
          async () => {
            const answer = await answerQuestion(question.question, mode);
            const result = score(question.expected, answer.citedIds);
            rows.push({
              question,
              mode,
              score: result,
              cited: answer.citedIds,
              tools: answer.toolCalls.map((c) => c.name),
              text: answer.text,
            });

            // Only the agentic path is asserted. Classic is the baseline being
            // measured, and failing the suite because the baseline is bad would
            // defeat the purpose of running it.
            if (mode === 'agentic') {
              if (question.shape === 'negative') {
                expect(answer.citedIds, `hallucinated: ${answer.text.slice(0, 200)}`).toEqual([]);
              } else {
                expect(result.recall, `recall too low. cited=${answer.citedIds.join(',')} expected=${question.expected.join(',')}`).toBeGreaterThanOrEqual(0.9);
              }
            }
          },
        );
      }
    });
  }
});

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`.padStart(4);
}

afterAll(() => {
  if (!ready) {
    const why = !indexExists() ? 'no index (run `npm run ingest`)' : 'no GOOGLE_GENERATIVE_AI_API_KEY';
    console.log(`\n  eval skipped — ${why}\n`);
    return;
  }
  if (rows.length === 0) return;

  const line = '─'.repeat(96);
  console.log(`\n${line}\n  RETRIEVAL EVAL — ${questions.length} questions derived from ground truth, ${MODES.length} modes\n${line}`);
  console.log(
    `  ${'question'.padEnd(46)} ${'shape'.padEnd(16)} ${'agentic P/R'.padEnd(13)} ${'classic P/R'}`,
  );
  console.log(`  ${'─'.repeat(46)} ${'─'.repeat(16)} ${'─'.repeat(13)} ${'─'.repeat(13)}`);

  for (const question of questions) {
    const cells = MODES.map((mode) => {
      const row = rows.find((r) => r.question.id === question.id && r.mode === mode);
      return row ? `${pct(row.score.precision)} /${pct(row.score.recall)}` : '     —      ';
    });
    const label = question.question.length > 45 ? `${question.question.slice(0, 42)}...` : question.question;
    console.log(`  ${label.padEnd(46)} ${question.shape.padEnd(16)} ${cells[0].padEnd(13)} ${cells[1]}`);
  }

  console.log(`  ${'─'.repeat(96)}`);
  const summary = MODES.map((mode) => {
    const modeRows = rows.filter((r) => r.mode === mode);
    return {
      mode,
      precision: mean(modeRows.map((r) => r.score.precision)),
      recall: mean(modeRows.map((r) => r.score.recall)),
      f1: mean(modeRows.map((r) => r.score.f1)),
    };
  });
  for (const s of summary) {
    console.log(`  ${s.mode.padEnd(46)} ${''.padEnd(16)} precision ${pct(s.precision)}   recall ${pct(s.recall)}   F1 ${pct(s.f1)}`);
  }

  const aggregation = MODES.map((mode) => {
    const modeRows = rows.filter((r) => r.mode === mode && r.question.shape === 'aggregation');
    return { mode, recall: mean(modeRows.map((r) => r.score.recall)) };
  });
  const hallucinated = MODES.map((mode) => ({
    mode,
    count: rows.filter((r) => r.mode === mode && r.question.shape === 'negative' && r.cited.length > 0).length,
  }));

  console.log(`\n  aggregation recall   agentic ${pct(aggregation[0].recall)}   vs   classic ${pct(aggregation[1].recall)}`);
  console.log(`  hallucinated names   agentic ${String(hallucinated[0].count).padStart(4)}   vs   classic ${String(hallucinated[1].count).padStart(4)}`);
  console.log(`${line}\n`);
});
