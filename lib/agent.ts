import { generateText, stepCountIs, streamText, type ModelMessage } from 'ai';
import { textModel } from './llm';
import { cvTools, getRoster, searchCvs } from './tools';
import type { ChatMode } from './schemas';

/**
 * The agentic loop, shared by the chat route and the eval harness (PRD §7.3).
 *
 * Both entry points must run the same prompt, the same tools and the same step
 * budget — an eval that measures a different code path from the one shipped
 * measures nothing.
 */

/**
 * Five steps covers the shapes this corpus produces (filter, then fetch two or
 * three matches) and is low enough that a confused model fails fast rather than
 * grinding through the free tier.
 */
export const MAX_STEPS = 5;

/** Classic RAG's k. Small on purpose: this is the baseline, not the product. */
export const CLASSIC_TOP_K = 5;

export function buildSystemPrompt(): string {
  const roster = getRoster();
  const lines = roster.map((c) => `${c.id}: ${c.name} — ${c.current_title}, ${c.location}`).join('\n');

  return `You are a CV screening assistant for a recruiting team. You answer questions about a fixed corpus of ${roster.length} candidate CVs, and you have three retrieval tools.

ROUTING
- filter_candidates — for "who has X", "how many", counts, and any exact attribute
  (skill, university, spoken language, employer, seniority, location, years).
  It returns EVERY match with a total, so use it whenever the honest answer is a
  complete set rather than a few examples. Its skill and institution matching is
  alias-aware, so pass the user's own wording ("UPC", "k8s", "Postgres").
- search_cvs — for fuzzy, conceptual questions where the wording on the CV will
  not match the wording in the question ("who has scaled a platform team?").
- get_cv — whenever the question is about one named person: summaries, profiles,
  "tell me about". Look their id up in the roster below and fetch the whole
  document rather than relying on chunks.

Combining tools is expected: filter first to get the set, then get_cv on the ones
worth describing in detail.

ANSWERING
- Use only what the tools return. You have no other knowledge of these candidates.
- If a filter returns nothing, say plainly that no candidate in the corpus matches.
  Never soften a zero result by offering near-misses as if they matched, and never
  fill a gap from your own knowledge.
- Cite the candidate id inline in parentheses the first time you name someone,
  like "Xavier Prieto (cv_014)". Never cite an id you did not receive from a tool.
- When a tool reports a total, state the number.
- Be direct and concise. A recruiter is scanning, not reading. Prefer a short list
  of "Name (id) — the one fact that answers the question" over prose paragraphs.
- Answer in the language the user asked in.

ROSTER (the complete corpus — every candidate that exists)
${lines}`;
}

const CLASSIC_SYSTEM =
  'You are a CV screening assistant. Answer the question using only the CV excerpts provided below. ' +
  'Cite the candidate id inline in parentheses, like "Xavier Prieto (cv_014)". ' +
  'If the excerpts do not contain the answer, say so.';

/**
 * Classic single-shot RAG: embed, take top-k, stuff, answer. No tools, no second
 * look. ~30 lines, which is the point — it exists so the eval can measure the
 * difference rather than assert it.
 */
export async function buildClassicSystemPrompt(question: string): Promise<{ system: string; citedIds: string[] }> {
  const { hits } = await searchCvs({ query: question, top_k: CLASSIC_TOP_K });
  const context = hits
    .map((hit, i) => `[${i + 1}] ${hit.name} (${hit.candidate_id}) — ${hit.section}, page ${hit.page}\n${hit.text}`)
    .join('\n\n');
  return {
    system: `${CLASSIC_SYSTEM}\n\nCV EXCERPTS\n${context || '(no excerpts retrieved)'}`,
    citedIds: [...new Set(hits.map((h) => h.candidate_id))],
  };
}

export async function streamAnswer(messages: ModelMessage[], mode: ChatMode, question: string) {
  if (mode === 'classic') {
    const { system } = await buildClassicSystemPrompt(question);
    return streamText({ model: textModel(), system, messages });
  }
  return streamText({
    model: textModel(),
    system: buildSystemPrompt(),
    messages,
    tools: cvTools,
    stopWhen: stepCountIs(MAX_STEPS),
  });
}

export interface AnswerResult {
  text: string;
  /** Candidate ids cited in the prose — what the eval scores. */
  citedIds: string[];
  /** Candidate ids the retrieval layer actually returned, cited or not. */
  retrievedIds: string[];
  toolCalls: { name: string; input: unknown }[];
  steps: number;
}

const ID_PATTERN = /\bcv_\d{3}\b/g;

export function extractCitedIds(text: string): string[] {
  return [...new Set(text.match(ID_PATTERN) ?? [])].sort();
}

/** Ids reachable in a tool result, whatever its shape. */
function idsFromToolOutput(output: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === 'candidate_id' && typeof value === 'string') found.add(value);
        else if (key === 'id' && typeof value === 'string' && /^cv_\d{3}$/.test(value)) found.add(value);
        else walk(value);
      }
    }
  };
  walk(output);
  return [...found];
}

/**
 * One question, one answer, non-streaming. The eval harness calls this so it
 * exercises exactly the prompt and tools the app ships.
 */
export async function answerQuestion(question: string, mode: ChatMode): Promise<AnswerResult> {
  const messages: ModelMessage[] = [{ role: 'user', content: question }];

  if (mode === 'classic') {
    const { system, citedIds } = await buildClassicSystemPrompt(question);
    const { text } = await generateText({ model: textModel(), system, messages, maxRetries: 3 });
    return { text, citedIds: extractCitedIds(text), retrievedIds: citedIds, toolCalls: [], steps: 1 };
  }

  const result = await generateText({
    model: textModel(),
    system: buildSystemPrompt(),
    messages,
    tools: cvTools,
    stopWhen: stepCountIs(MAX_STEPS),
    maxRetries: 3,
  });

  const retrieved = new Set<string>();
  const toolCalls: { name: string; input: unknown }[] = [];
  for (const step of result.steps) {
    for (const call of step.toolCalls) toolCalls.push({ name: call.toolName, input: call.input });
    for (const toolResult of step.toolResults) {
      for (const id of idsFromToolOutput(toolResult.output)) retrieved.add(id);
    }
  }

  return {
    text: result.text,
    citedIds: extractCitedIds(result.text),
    retrievedIds: [...retrieved].sort(),
    toolCalls,
    steps: result.steps.length,
  };
}
