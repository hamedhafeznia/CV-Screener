import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { embed, embedMany, experimental_generateImage as generateImage, generateText } from 'ai';
import type { EmbeddingModel, LanguageModel } from 'ai';

/**
 * The only module that knows the provider is Gemini (PRD §10).
 *
 * Everything downstream — ingest, tools, chat route, eval — imports `textModel`,
 * `embedDocuments`, `embedQuery`. Swapping providers is a change to this file.
 */

export const LLM_MODEL = process.env.LLM_MODEL || 'gemini-3.5-flash';
export const EMBED_MODEL = process.env.EMBED_MODEL || 'gemini-embedding-001';
export const IMAGE_MODEL = process.env.IMAGE_MODEL || 'gemini-3.1-flash-image';

/**
 * 768 rather than the native 3072 (PRD §6.3). gemini-embedding-001 is a
 * Matryoshka model, so a truncated prefix is still a valid embedding — the index
 * drops from ~4 MB to ~1 MB, which matters because it is committed to git.
 */
export const EMBED_DIMS = 768;

export function hasApiKey(): boolean {
  return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
}

export function requireApiKey(): string {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) {
    throw new Error(
      'GOOGLE_GENERATIVE_AI_API_KEY is not set. Copy .env.example to .env and add a key from https://aistudio.google.com/apikey',
    );
  }
  return key;
}

let cachedProvider: ReturnType<typeof createGoogleGenerativeAI> | null = null;

function provider() {
  if (!cachedProvider) {
    cachedProvider = createGoogleGenerativeAI({ apiKey: requireApiKey() });
  }
  return cachedProvider;
}

export function textModel(modelId: string = LLM_MODEL): LanguageModel {
  return provider()(modelId);
}

function embeddingModel(): EmbeddingModel<string> {
  return provider().textEmbeddingModel(EMBED_MODEL);
}

/**
 * Document- and query-side embeddings are asymmetric: gemini-embedding-001 is
 * trained with distinct task prefixes, and using one task type for both
 * measurably costs recall. Keeping them in two named functions makes it hard to
 * get wrong at a call site.
 */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embeddings } = await embedMany({
    model: embeddingModel(),
    values: texts,
    maxParallelCalls: 4,
    maxRetries: 3,
    providerOptions: {
      google: { outputDimensionality: EMBED_DIMS, taskType: 'RETRIEVAL_DOCUMENT' },
    },
  });
  return embeddings.map((e) => [...e]);
}

export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: embeddingModel(),
    value: text,
    maxRetries: 3,
    providerOptions: {
      google: { outputDimensionality: EMBED_DIMS, taskType: 'RETRIEVAL_QUERY' },
    },
  });
  return [...embedding];
}

/**
 * One headshot. Supports both Imagen models (via the image API) and the Gemini
 * *-image chat models (which return images as files on a text response).
 *
 * Returns null rather than throwing when image generation is unavailable —
 * headshots are not on the Gemini free tier, and a missing photo must never stop
 * the corpus from being generated. `scripts/generate.ts` falls back to a
 * deterministic local avatar.
 */
export async function generateHeadshot(prompt: string): Promise<Uint8Array | null> {
  try {
    if (IMAGE_MODEL.startsWith('imagen')) {
      const { image } = await generateImage({
        model: provider().image(IMAGE_MODEL),
        prompt,
        n: 1,
        aspectRatio: '1:1',
        providerOptions: { google: { personGeneration: 'allow_adult' } },
      });
      return image.uint8Array;
    }

    const result = await generateText({
      model: provider()(IMAGE_MODEL),
      prompt,
      providerOptions: { google: { responseModalities: ['IMAGE'] } },
    });
    const file = result.files.find((f) => f.mediaType.startsWith('image/'));
    return file ? file.uint8Array : null;
  } catch (error) {
    console.warn(`  ! image generation unavailable (${(error as Error).message.split('\n')[0]})`);
    return null;
  }
}
