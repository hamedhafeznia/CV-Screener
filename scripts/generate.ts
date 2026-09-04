/**
 * Part 1 — the CV generation pipeline (PRD §5).
 *
 *   sampler → LLM structured output → headshot → HTML template → Playwright → PDF
 *
 * Every stage is cached on disk and keyed by candidate id, so a re-run after a
 * crash costs nothing and never re-bills an image. `--force` overrides.
 *
 *   npm run generate
 *   npm run generate -- --only cv_014 --force
 *   npm run generate -- --limit 3 --no-photos
 */
import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { generateObject } from 'ai';
import { chromium, type Browser } from 'playwright';
import { CVProfileSchema, GeneratedCVSchema, type CVProfile } from '../lib/schemas';
import { textModel } from '../lib/llm';
import { sampleSpecs, type CVSpec } from './lib/sampler';
import { avatarSvg, renderCV } from './templates';

// Free tier is 20 requests/minute. Pace batch runs just under it so they proceed
// steadily instead of sprinting into a 429 and waiting it out (lib/llm.ts).
process.env.LLM_MIN_INTERVAL_MS ||= '3300';

const ROOT = process.cwd();
const DIRS = {
  cvs: path.join(ROOT, 'data/cvs'),
  photos: path.join(ROOT, 'data/photos'),
  truth: path.join(ROOT, 'data/ground_truth'),
};

/* ----------------------------------------------------------------- args --- */

interface Args {
  force: boolean;
  photos: boolean;
  only: string[] | null;
  limit: number | null;
  concurrency: number;
}

function parseArgs(argv: string[]): Args {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const only = value('--only');
  const limit = value('--limit');
  const concurrency = value('--concurrency');
  return {
    force: argv.includes('--force'),
    photos: !argv.includes('--no-photos'),
    only: only ? only.split(',').map((s) => s.trim()) : null,
    limit: limit ? Number(limit) : null,
    concurrency: concurrency ? Number(concurrency) : 2,
  };
}

/* ------------------------------------------------------------- profiles --- */

function profilePrompt(spec: CVSpec): string {
  const language = spec.cv_language === 'es' ? 'Spanish (español)' : 'English';
  return [
    `Write the content of one realistic CV for this exact person.`,
    ``,
    `Name: ${spec.name}`,
    `Target role: ${spec.role_title} (${spec.seniority}, ${spec.years} years of experience)`,
    `Lives in: ${spec.city}`,
    `Studied at: ${spec.university} — ${spec.degree_level} in ${spec.degree_field}`,
    `Languages spoken: ${spec.languages.map((l) => `${l.language} (${l.level})`).join(', ')}`,
    `Required skills — every one of these must appear in "skills", spelled exactly as written here:`,
    `  ${spec.skills_bias.join(', ')}`,
    `Employers — use ONLY these companies, in reverse-chronological order, ${spec.num_roles} roles total:`,
    `  ${spec.companies.join(', ')}`,
    ``,
    `Rules:`,
    `- Write the prose (summary and role descriptions) in ${language}. Keep company names,`,
    `  the university name, skill names and job titles in their normal industry form.`,
    `- "institution" must be the full official name "${spec.university}" — never an acronym.`,
    `- Add 2-5 further skills that genuinely fit this role, beyond the required list.`,
    `- Role descriptions: 2-4 sentences, naming concrete systems and quantified outcomes`,
    `  (latency, throughput, cost, conversion, team size). No filler adjectives.`,
    `- Dates must be consistent, non-overlapping, and add up to about ${spec.years} years,`,
    `  with the most recent role ending "Present".`,
    `- email: a plausible personal address built from the name. phone: local format for ${spec.city}.`,
    `- location: "${spec.city}". current_title: "${spec.role_title}".`,
    `- seniority: "${spec.seniority}". years_experience: ${spec.years}.`,
    `- Education: one entry (${spec.degree_level}), or two if a Master's plus a Bachelor's is natural.`,
  ].join('\n');
}

async function buildProfile(spec: CVSpec, force: boolean): Promise<CVProfile> {
  const file = path.join(DIRS.truth, `${spec.id}.json`);
  if (!force && existsSync(file)) {
    return CVProfileSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  }

  const { object } = await generateObject({
    model: textModel(),
    schema: GeneratedCVSchema,
    schemaName: 'CVProfile',
    schemaDescription: 'The full content of one candidate CV.',
    system:
      'You write realistic, specific CV content for fictional candidates. ' +
      'Concrete over generic: real technologies, real-sounding projects, numbers that make sense. ' +
      'Never invent an employer or university that was not given to you.',
    prompt: profilePrompt(spec),
    maxRetries: 4,
  });

  // The sampler owns identity fields; the model owns prose. Where they disagree,
  // the sampler wins — otherwise ground truth stops matching the corpus design.
  const profile: CVProfile = CVProfileSchema.parse({
    ...object,
    id: spec.id,
    name: spec.name,
    location: spec.city,
    current_title: spec.role_title,
    seniority: spec.seniority,
    years_experience: spec.years,
  });

  await writeFile(file, JSON.stringify(profile, null, 2) + '\n', 'utf8');
  return profile;
}

/* --------------------------------------------------------------- photos --- */

function headshotPrompt(spec: CVSpec): string {
  return [
    `A professional corporate headshot photograph of one adult person, chest-up, facing the camera.`,
    `Styling: ${spec.photo_hint}.`,
    `Shot on an 85mm lens at f/2.8, even soft key light, natural skin texture, sharp focus on the eyes.`,
    `Square crop. No text, no watermark, no logo, no border, one person only.`,
  ].join(' ');
}

/** Deterministic initials avatar, rasterised by the browser we already have open. */
async function renderAvatarPng(browser: Browser, spec: CVSpec): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
  try {
    await page.setContent(
      `<body style="margin:0">${avatarSvg(spec.id, spec.name)}</body>`,
      { waitUntil: 'load' },
    );
    return await page.screenshot({ type: 'png' });
  } finally {
    await page.close();
  }
}

async function buildPhoto(
  spec: CVSpec,
  browser: Browser,
  args: Args,
): Promise<{ dataUri: string; generated: boolean }> {
  const file = path.join(DIRS.photos, `${spec.id}.png`);
  if (!args.force && existsSync(file)) {
    return { dataUri: toDataUri(await readFile(file)), generated: false };
  }

  let bytes: Buffer | null = null;
  if (args.photos) {
    // Imported lazily so `--no-photos` runs never touch the image model.
    const { generateHeadshot } = await import('../lib/llm');
    const image = await generateHeadshot(headshotPrompt(spec));
    if (image) bytes = Buffer.from(image);
  }

  const generated = bytes !== null;
  if (!bytes) bytes = await renderAvatarPng(browser, spec);

  await writeFile(file, bytes);
  return { dataUri: toDataUri(bytes), generated };
}

function toDataUri(bytes: Buffer): string {
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

/* ------------------------------------------------------------------ pdf --- */

async function buildPdf(spec: CVSpec, profile: CVProfile, photoDataUri: string, browser: Browser): Promise<void> {
  const target = path.join(DIRS.cvs, `${spec.id}.pdf`);
  const html = renderCV(profile, {
    template: spec.template_id,
    photoDataUri,
    language: spec.cv_language,
  });

  const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
  try {
    await page.setContent(html, { waitUntil: 'load' });

    if (!spec.flatten_to_image) {
      await page.pdf({ path: target, format: 'A4', printBackground: true });
      return;
    }

    // The deliberate hard case (PRD §5.3): screenshot the rendered page and wrap
    // the bitmap in an otherwise empty PDF. The result has no text layer at all,
    // which is what forces ingest down the vision fallback.
    const shot = await page.screenshot({ type: 'png', fullPage: true });
    await page.setContent(
      `<body style="margin:0"><img src="${toDataUri(shot)}" ` +
        `style="display:block;width:210mm;height:297mm;object-fit:contain;object-position:top"></body>`,
      { waitUntil: 'load' },
    );
    await page.pdf({ path: target, format: 'A4', printBackground: true });
  } finally {
    await page.close();
  }
}

/* ----------------------------------------------------------------- main --- */

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await Promise.all(Object.values(DIRS).map((dir) => mkdir(dir, { recursive: true })));

  let specs = sampleSpecs();
  if (args.only) specs = specs.filter((s) => args.only!.includes(s.id));
  if (args.limit) specs = specs.slice(0, args.limit);

  console.log(`generating ${specs.length} CVs (concurrency ${args.concurrency}, photos ${args.photos ? 'on' : 'off'})\n`);

  const browser = await chromium.launch();
  let realHeadshots = 0;
  try {
    await mapWithConcurrency(specs, args.concurrency, async (spec) => {
      const profile = await buildProfile(spec, args.force);
      const photo = await buildPhoto(spec, browser, args);
      if (photo.generated) realHeadshots++;
      await buildPdf(spec, profile, photo.dataUri, browser);
      const tags = [
        spec.template_id,
        spec.cv_language,
        spec.flatten_to_image ? 'image-only' : '',
        photo.generated ? 'headshot' : 'avatar',
      ].filter(Boolean);
      console.log(`  ${spec.id}  ${spec.name.padEnd(20)} ${profile.skills.length} skills · ${profile.experience.length} roles · ${tags.join(' · ')}`);
    });
  } finally {
    await browser.close();
  }

  console.log(`\ndone — ${specs.length} PDFs in data/cvs, ${realHeadshots} AI headshots, ${specs.length - realHeadshots} fallback avatars.`);
  if (realHeadshots === 0 && args.photos) {
    console.log('note: no image model reached. Set IMAGE_MODEL and enable billing to get real headshots.');
  }
}

main().catch((error) => {
  console.error(`\n✗ ${(error as Error).stack ?? error}`);
  process.exit(1);
});
