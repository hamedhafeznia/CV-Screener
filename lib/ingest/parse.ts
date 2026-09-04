import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { generateObject } from 'ai';
import { CVProfileSchema, GeneratedCVSchema, type CVProfile } from '../schemas';
import { LLM_MODEL, textModel } from '../llm';
import type { ExtractedPdf } from './extract';

/**
 * Stage 2 of ingest (PRD §6): extracted page text -> `CVProfile`.
 *
 * Deliberately the same Zod schema the generator wrote against, so the
 * round-trip (structured -> PDF -> text -> structured) is directly diffable
 * against `data/ground_truth/*.json`.
 *
 * Results are cached by a hash of (text + model + prompt), because the free tier
 * has a request budget and a second `npm run ingest` should cost nothing.
 */

const CACHE_DIR = path.join(process.cwd(), 'data/.cache');

/** Bump when the prompt or schema changes, to invalidate every cached parse. */
const PROMPT_VERSION = 'v1';

const SYSTEM =
  'You extract structured data from CV text. Copy what the document says; never infer, ' +
  'never embellish, never add a skill or employer that is not written down. ' +
  'If a field is genuinely absent, use an empty string or an empty array.';

function buildPrompt(candidateId: string, pages: string[]): string {
  const pageBlocks = pages.map((text, i) => `--- PAGE ${i + 1} ---` + '\n' + text);
  return [
    `Extract the structured profile from this CV. It has ${pages.length} page(s).`,
    ``,
    ...pageBlocks,
    ``,
    `Rules:`,
    `- "institution" must be the full name exactly as printed, not an acronym.`,
    `- "skills" must list every skill named anywhere on the CV, each with a sensible category.`,
    `- "experience" must be reverse-chronological, one entry per role.`,
    `- "years_experience" is a number; take the figure stated on the CV if there is one.`,
    `- "seniority" is one of junior, mid, senior, lead, principal - infer from the current title.`,
    `- Keep prose in the language it is written in. Do not translate.`,
    `- The candidate id is "${candidateId}".`,
  ].join('\n');
}

function cacheKey(candidateId: string, pages: string[]): string {
  return createHash('sha256')
    .update([PROMPT_VERSION, LLM_MODEL, candidateId, ...pages].join(' '))
    .digest('hex');
}

export interface ParseResult {
  profile: CVProfile;
  cached: boolean;
}

export async function parseProfile(
  candidateId: string,
  extracted: ExtractedPdf,
  options: { force?: boolean } = {},
): Promise<ParseResult> {
  const pages = extracted.pages.map((p) => p.text);
  const file = path.join(CACHE_DIR, `${cacheKey(candidateId, pages)}.json`);

  if (!options.force && existsSync(file)) {
    return { profile: CVProfileSchema.parse(JSON.parse(await readFile(file, 'utf8'))), cached: true };
  }

  const { object } = await generateObject({
    model: textModel(),
    schema: GeneratedCVSchema,
    schemaName: 'CVProfile',
    schemaDescription: 'Structured profile extracted from a CV document.',
    system: SYSTEM,
    prompt: buildPrompt(candidateId, pages),
    maxRetries: 4,
  });

  const profile = CVProfileSchema.parse({ ...object, id: candidateId });
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(profile, null, 2) + '\n', 'utf8');
  return { profile, cached: false };
}
