/**
 * Preflight: proves the API key works and reports which models this key can
 * actually reach, before you spend twenty minutes on a generation run.
 *
 *   npm run check
 */
import 'dotenv/config';
import { generateText } from 'ai';
import { EMBED_DIMS, EMBED_MODEL, IMAGE_MODEL, LLM_MODEL, embedQuery, requireApiKey, textModel } from '../lib/llm';

async function listModels(apiKey: string): Promise<string[]> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${apiKey}`);
  if (!res.ok) throw new Error(`ListModels failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { models?: { name: string }[] };
  return (body.models ?? []).map((m) => m.name.replace('models/', '')).sort();
}

async function main() {
  const apiKey = requireApiKey();
  console.log(`configured  text=${LLM_MODEL}  embed=${EMBED_MODEL}  image=${IMAGE_MODEL}\n`);

  const available = await listModels(apiKey);
  console.log(`${available.length} models visible to this key.`);
  for (const [label, id] of [
    ['text ', LLM_MODEL],
    ['embed', EMBED_MODEL],
    ['image', IMAGE_MODEL],
  ] as const) {
    console.log(`  ${available.includes(id) ? '✓' : '✗'} ${label}  ${id}`);
  }
  const missing = [LLM_MODEL, EMBED_MODEL].filter((id) => !available.includes(id));
  if (missing.length) {
    console.log('\nclosest available:');
    for (const id of missing) {
      const stem = id.split('-').slice(0, 2).join('-');
      console.log(`  ${id} -> ${available.filter((m) => m.startsWith(stem)).slice(0, 8).join(', ') || '(none)'}`);
    }
  }

  const { text } = await generateText({
    model: textModel(),
    prompt: 'Reply with exactly: cv-screener online',
  });
  console.log(`\ntext model  → ${text.trim()}`);

  const vector = await embedQuery('senior backend engineer with Kubernetes experience');
  console.log(`embeddings  → ${vector.length} dims (expected ${EMBED_DIMS})`);
  if (vector.length !== EMBED_DIMS) throw new Error(`unexpected dimensionality: ${vector.length}`);

  console.log('\nready — run `npm run generate`.');
}

main().catch((error) => {
  console.error(`\n✗ ${(error as Error).message}`);
  process.exit(1);
});
