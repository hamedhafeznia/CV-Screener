/**
 * Part 2 — the ingest pipeline (PRD §6).
 *
 *   PDF -> per-page text (column-aware, vision fallback)
 *       -> LLM structured extraction  (cached by content hash)
 *       -> alias normalization
 *       -> section-aware, identity-prefixed chunks
 *       -> embeddings -> SQLite + LanceDB
 *
 * Always a full rebuild. Re-running is cheap because stage 2 is cached, so the
 * only real cost of a second run is re-embedding.
 *
 *   npm run ingest
 *   npm run ingest -- --only cv_010 --no-vision
 */
import 'dotenv/config';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { extractPdf } from '../lib/ingest/extract';
import { parseProfile } from '../lib/ingest/parse';
import { normalizeProfile } from '../lib/ingest/normalize';
import { chunkProfile } from '../lib/ingest/chunk';
import { buildIndex, type IndexInput } from '../lib/ingest/index';
import { CVProfileSchema } from '../lib/schemas';

// Free tier is 20 requests/minute. Pace batch runs just under it so they proceed
// steadily instead of sprinting into a 429 and waiting it out (lib/llm.ts).
process.env.LLM_MIN_INTERVAL_MS ||= '3300';

const ROOT = process.cwd();
const CV_DIR = path.join(ROOT, 'data/cvs');
const PHOTO_DIR = path.join(ROOT, 'data/photos');
const TRUTH_DIR = path.join(ROOT, 'data/ground_truth');

interface Args {
  only: string[] | null;
  vision: boolean;
  force: boolean;
  /** Skip the LLM extraction and read data/ground_truth instead. */
  fromGroundTruth: boolean;
}

function parseArgs(argv: string[]): Args {
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : undefined;
  return {
    only: only ? only.split(',').map((s) => s.trim()) : null,
    vision: !argv.includes('--no-vision'),
    force: argv.includes('--force'),
    fromGroundTruth: argv.includes('--from-ground-truth'),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(path.join(ROOT, 'data/.cache'), { recursive: true });

  if (!existsSync(CV_DIR)) {
    throw new Error(`No CVs found at ${CV_DIR}. Run \`npm run generate\` first.`);
  }
  let ids = (await readdir(CV_DIR))
    .filter((f) => f.endsWith('.pdf'))
    .map((f) => path.basename(f, '.pdf'))
    .sort();
  if (args.only) ids = ids.filter((id) => args.only!.includes(id));
  if (ids.length === 0) throw new Error(`No PDFs matched in ${CV_DIR}.`);

  console.log(`ingesting ${ids.length} CVs (vision ${args.vision ? 'on' : 'off'}${args.fromGroundTruth ? ', ground-truth mode' : ''})\n`);

  const inputs: IndexInput[] = [];
  let visionPages = 0;
  let twoColumn = 0;
  let cachedParses = 0;

  for (const id of ids) {
    const pdfPath = path.join(CV_DIR, `${id}.pdf`);
    const extracted = await extractPdf(pdfPath, { vision: args.vision });
    visionPages += extracted.pages.filter((p) => p.source === 'vision').length;
    if (extracted.pages.some((p) => p.columns === 2)) twoColumn++;

    // `--from-ground-truth` exists so the index can be rebuilt with no API budget
    // at all. It is not the default: the point of the pipeline is that extraction
    // is a real step, and the eval only means something if the profiles under
    // test were read back out of the PDFs.
    let profile;
    if (args.fromGroundTruth) {
      profile = CVProfileSchema.parse(JSON.parse(await readFile(path.join(TRUTH_DIR, `${id}.json`), 'utf8')));
    } else {
      const parsed = await parseProfile(id, extracted, { force: args.force });
      if (parsed.cached) cachedParses++;
      profile = parsed.profile;
    }

    const normalized = normalizeProfile(profile);
    const chunks = chunkProfile(profile, extracted);

    inputs.push({
      normalized,
      chunks,
      pdfPath: `data/cvs/${id}.pdf`,
      photoPath: existsSync(path.join(PHOTO_DIR, `${id}.png`)) ? `data/photos/${id}.png` : '',
      numPages: extracted.numPages,
      fullText: extracted.pages.map((p) => p.text).join('\n\n'),
    });

    const flags = [
      `${extracted.numPages}p`,
      extracted.pages.some((p) => p.columns === 2) ? '2-col' : '1-col',
      extracted.pages.some((p) => p.source === 'vision') ? 'vision' : '',
    ].filter(Boolean);
    console.log(`  ${id}  ${profile.name.padEnd(20)} ${String(chunks.length).padStart(2)} chunks · ${normalized.skills.length} skills · ${flags.join(' · ')}`);
  }

  console.log();
  const result = await buildIndex(inputs, (message) => console.log(`  ${message}`));

  // A small manifest so the UI and the README can state what is in the index
  // without opening it.
  await writeFile(
    path.join(ROOT, 'data/index-manifest.json'),
    JSON.stringify(
      {
        built_at: new Date().toISOString(),
        candidates: result.candidates,
        chunks: result.chunks,
        embedding_dims: result.dims,
        vision_pages: visionPages,
        two_column_cvs: twoColumn,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  console.log(
    `\ndone — ${result.candidates} candidates, ${result.chunks} chunks, ${result.dims} dims.` +
      `\n  ${twoColumn} CVs needed column-aware ordering, ${visionPages} pages needed the vision fallback` +
      `, ${cachedParses} parses served from cache.`,
  );
}

main().catch((error) => {
  console.error(`\n✗ ${(error as Error).stack ?? error}`);
  process.exit(1);
});
