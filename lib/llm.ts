import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { embed, embedMany, experimental_generateImage as generateImage, generateText } from 'ai';
import type { EmbeddingModel, LanguageModel } from 'ai';

/**
 * The only module that knows the provider is Gemini (PRD §10).
 *
 * Everything downstream — ingest, tools, chat route, eval — imports `textModel`,
 * `embedDocuments`, `embedQuery`. Swapping providers is a change to this file.
 */

/**
 * `LLM_MODEL` accepts a comma-separated chain, not just one id.
 *
 * The free tier's cap is 20 requests per day *per model*, which is not enough to
 * generate a corpus, ingest it and run an eval — but the buckets are
 * independent, so an exhausted model can be rolled past rather than waited on.
 * With billing enabled, set a single id and the rotation never triggers.
 */
export const LLM_MODELS = (process.env.LLM_MODEL || 'gemini-3.5-flash')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

/** The model currently in use. Advances only when a daily quota is exhausted. */
export const LLM_MODEL = LLM_MODELS[0];
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

/* --------------------------------------------------------- rate limiting --- */

/**
 * The free tier allows 20 requests per minute, and a batch run blows through
 * that in seconds. The AI SDK's own retry uses blind exponential backoff, which
 * tops out around 30 seconds — just short of the ~38 seconds Google actually
 * asks for, so a generation run dies two-thirds of the way through.
 *
 * Google returns the exact wait in a RetryInfo detail on every 429. Honouring it
 * is both more reliable and faster than guessing, so it is handled here in the
 * fetch layer rather than per call site: every model call in the project —
 * generation, ingest, chat, eval — goes through it for free.
 */
const MAX_429_RETRIES = 8;

/**
 * Minimum spacing between requests. Batch scripts set this so they stay under
 * the cap instead of sprinting into it and backing off; the app leaves it at 0,
 * because a chat turn is a handful of sequential calls and pacing would only
 * add latency.
 */
function minIntervalMs(): number {
  return Number(process.env.LLM_MIN_INTERVAL_MS ?? 0) || 0;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(() => resolve(), ms));

/** Serialises request *starts* so concurrent callers still respect the spacing. */
let gate: Promise<void> = Promise.resolve();

function pace(): Promise<void> {
  const interval = minIntervalMs();
  if (interval <= 0) return Promise.resolve();
  const wait = gate.then(() => sleep(interval));
  gate = wait;
  return wait;
}

interface QuotaError {
  /** Milliseconds the API asks us to wait. */
  retryMs: number;
  /** True when the exhausted bucket resets daily, so waiting is pointless. */
  daily: boolean;
}

/** Read the retry delay and quota kind out of a 429 body. */
async function readQuotaError(response: Response): Promise<QuotaError> {
  let retryMs = 30_000;
  let daily = false;

  const header = response.headers.get('retry-after');
  if (header && Number.isFinite(Number(header))) retryMs = Number(header) * 1000 + 500;

  try {
    const body = (await response.clone().json()) as {
      error?: { details?: { retryDelay?: string; violations?: { quotaId?: string }[] }[] };
    };
    for (const detail of body.error?.details ?? []) {
      const seconds = Number.parseFloat(detail.retryDelay ?? '');
      if (Number.isFinite(seconds)) retryMs = seconds * 1000 + 500;
      for (const violation of detail.violations ?? []) {
        if (/PerDay/i.test(violation.quotaId ?? '')) daily = true;
      }
    }
  } catch {
    // Body was not JSON; the defaults above stand.
  }
  return { retryMs, daily };
}

/** Index into LLM_MODELS. Advances when a model's daily quota is spent. */
let activeModel = 0;

export function currentModel(): string {
  return LLM_MODELS[activeModel];
}

const MODEL_URL = /\/models\/([^:/]+):/;

/** Point a request at whichever model in the chain is still in budget. */
function retarget(input: RequestInfo | URL): RequestInfo | URL {
  if (LLM_MODELS.length < 2) return input;
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const match = url.match(MODEL_URL);
  // Only rewrite text-model calls; embeddings and images have their own quotas.
  if (!match || !LLM_MODELS.includes(match[1]) || match[1] === currentModel()) return input;
  const rewritten = url.replace(MODEL_URL, `/models/${currentModel()}:`);
  return typeof input === 'string' || input instanceof URL ? rewritten : new Request(rewritten, input);
}

/** Transient server-side failures worth retrying rather than surfacing. */
const OVERLOADED = new Set([500, 502, 503, 504]);

const throttledFetch: typeof fetch = async (input, init) => {
  let overloadAttempts = 0;

  for (let attempt = 0; ; attempt++) {
    await pace();
    const response = await fetch(retarget(input), init);

    const isTextCall = MODEL_URL.test(
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
    );

    // "This model is currently experiencing high demand" — a 503, not a quota
    // problem. Back off a little, and if a model stays busy, move down the chain
    // rather than failing a 30-document ingest two-thirds of the way through.
    if (OVERLOADED.has(response.status) && attempt < MAX_429_RETRIES) {
      overloadAttempts++;
      if (overloadAttempts >= 3 && isTextCall && activeModel < LLM_MODELS.length - 1) {
        activeModel++;
        console.warn(`  … ${response.status} from the model, switching to ${currentModel()}`);
        overloadAttempts = 0;
        continue;
      }
      const wait = Math.min(2000 * 2 ** overloadAttempts, 20_000);
      console.warn(`  … ${response.status} overloaded, retrying in ${(wait / 1000).toFixed(0)}s`);
      await sleep(wait);
      continue;
    }

    if (response.status !== 429 || attempt >= MAX_429_RETRIES) return response;

    const { retryMs, daily } = await readQuotaError(response);

    // A daily bucket will not clear by waiting. If another model in the chain is
    // still in budget, roll over to it and retry immediately.
    if (daily && isTextCall && activeModel < LLM_MODELS.length - 1) {
      activeModel++;
      console.warn(`  … daily quota spent, switching to ${currentModel()}`);
      continue;
    }
    if (daily && isTextCall) {
      return response; // Every model exhausted — surface it rather than hang.
    }

    if (minIntervalMs() > 0) {
      console.warn(`  … rate limited, waiting ${(retryMs / 1000).toFixed(0)}s (attempt ${attempt + 1}/${MAX_429_RETRIES})`);
    }
    await sleep(retryMs);
  }
};

let cachedProvider: ReturnType<typeof createGoogleGenerativeAI> | null = null;

function provider() {
  if (!cachedProvider) {
    cachedProvider = createGoogleGenerativeAI({ apiKey: requireApiKey(), fetch: throttledFetch });
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
/** Gemini's batchEmbedContents accepts at most 100 inputs per request. */
const EMBED_BATCH = 100;

export async function embedDocuments(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const out: number[][] = [];
  for (let start = 0; start < texts.length; start += EMBED_BATCH) {
    const { embeddings } = await embedMany({
      model: embeddingModel(),
      values: texts.slice(start, start + EMBED_BATCH),
      maxParallelCalls: 2,
      maxRetries: 3,
      providerOptions: {
        google: { outputDimensionality: EMBED_DIMS, taskType: 'RETRIEVAL_DOCUMENT' },
      },
    });
    for (const embedding of embeddings) out.push([...embedding]);
  }
  return out;
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
