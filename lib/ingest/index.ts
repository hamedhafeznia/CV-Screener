import { rm } from 'node:fs/promises';
import type { DatabaseSync } from 'node:sqlite';
import { EMBED_DIMS, embedDocuments } from '../llm';
import { CHUNK_TABLE, LANCE_PATH, connectLanceForIngest, createDbForIngest } from '../stores';
import type { Chunk } from './chunk';
import type { NormalizedProfile } from './normalize';

/**
 * Stage 5 of ingest (PRD §6): write both stores.
 *
 * Full rebuild, never an incremental sync — `schema.sql` drops every table and
 * the Lance directory is removed outright. Thirty CVs rebuild in seconds, so
 * upsert logic and migrations would be cost without benefit.
 */

export interface IndexInput {
  normalized: NormalizedProfile;
  chunks: Chunk[];
  pdfPath: string;
  photoPath: string;
  numPages: number;
  fullText: string;
}

export interface IndexResult {
  candidates: number;
  chunks: number;
  dims: number;
}

function insertCandidate(db: DatabaseSync, input: IndexInput) {
  const { profile } = input.normalized;

  db.prepare(
    `INSERT INTO candidates
       (id, name, email, phone, location, current_title, seniority, years_experience,
        summary, photo_path, pdf_path, num_pages, full_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    profile.id,
    profile.name,
    profile.email,
    profile.phone,
    profile.location,
    profile.current_title,
    profile.seniority,
    Math.round(profile.years_experience),
    profile.summary,
    input.photoPath,
    input.pdfPath,
    input.numPages,
    input.fullText,
  );

  const skill = db.prepare('INSERT INTO skills (candidate_id, skill, skill_norm, category) VALUES (?, ?, ?, ?)');
  for (const row of input.normalized.skills) {
    skill.run(row.candidate_id, row.skill, row.skill_norm, row.category);
  }

  const education = db.prepare(
    'INSERT INTO education (candidate_id, institution, institution_norm, degree, field, end_year) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const row of input.normalized.education) {
    education.run(row.candidate_id, row.institution, row.institution_norm, row.degree, row.field, Math.round(row.end_year));
  }

  const experience = db.prepare(
    'INSERT INTO experience (candidate_id, company, title, start_date, end_date, description, page) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  profile.experience.forEach((role, i) => {
    const page = input.chunks.find((c) => c.chunk_id === `${profile.id}#experience-${i}`)?.page ?? 1;
    experience.run(profile.id, role.company, role.title, role.start_date, role.end_date, role.description, page);
  });

  const language = db.prepare('INSERT INTO languages (candidate_id, language, level) VALUES (?, ?, ?)');
  for (const row of profile.languages) {
    language.run(profile.id, row.language, row.level);
  }
}

export interface ChunkRow extends Record<string, unknown> {
  chunk_id: string;
  candidate_id: string;
  candidate_name: string;
  section: string;
  page: number;
  text: string;
  vector: number[];
}

/**
 * Embed every chunk in the corpus and write both stores.
 *
 * Embeddings are batched across all candidates rather than per candidate: one
 * `embedMany` over ~300 chunks is far fewer round-trips than thirty of them,
 * which matters on a rate-limited free tier.
 */
export async function buildIndex(
  inputs: IndexInput[],
  onProgress?: (message: string) => void,
): Promise<IndexResult> {
  const log = onProgress ?? (() => {});

  const db = createDbForIngest();
  try {
    for (const input of inputs) insertCandidate(db, input);
    log(`sqlite: ${inputs.length} candidates written`);
  } finally {
    db.close();
  }

  const chunks = inputs.flatMap((input) => input.chunks);
  log(`embedding ${chunks.length} chunks at ${EMBED_DIMS} dims...`);
  const vectors = await embedDocuments(chunks.map((c) => c.text));

  const rows: ChunkRow[] = chunks.map((chunk, i) => ({
    chunk_id: chunk.chunk_id,
    candidate_id: chunk.candidate_id,
    candidate_name: chunk.candidate_name,
    section: chunk.section,
    page: chunk.page,
    text: chunk.text,
    vector: vectors[i],
  }));

  const wrongSize = rows.find((r) => r.vector.length !== EMBED_DIMS);
  if (wrongSize) {
    throw new Error(`embedding for ${wrongSize.chunk_id} has ${wrongSize.vector.length} dims, expected ${EMBED_DIMS}`);
  }

  await rm(LANCE_PATH, { recursive: true, force: true });
  const connection = await connectLanceForIngest();
  await connection.createTable(CHUNK_TABLE, rows, { mode: 'overwrite' });
  log(`lancedb: ${rows.length} chunks written to ${CHUNK_TABLE}`);

  return { candidates: inputs.length, chunks: rows.length, dims: EMBED_DIMS };
}
