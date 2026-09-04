import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as lancedb from '@lancedb/lancedb';

/**
 * The two stores (PRD §16, "Two stores, not one").
 *
 * SQLite holds facts and answers exact/aggregate questions; LanceDB holds chunk
 * vectors and answers fuzzy ones. Both are files on disk, which is the whole
 * point: the built index is committed to the repo, so a reviewer clones and runs
 * without an ingest, a server, or Docker.
 *
 * pgvector would unify metadata filtering and ANN into one pre-filtered query.
 * That is the production path, and it costs a database server we do not want here.
 */

export const DATA_DIR = path.join(process.cwd(), 'data');
export const SQLITE_PATH = path.join(DATA_DIR, 'candidates.db');
export const LANCE_PATH = path.join(DATA_DIR, 'index.lance');
export const CHUNK_TABLE = 'cv_chunks';

export class IndexNotBuiltError extends Error {
  constructor(missing: string) {
    super(`Search index not found at ${missing}. Run \`npm run ingest\` (or restore the committed index).`);
    this.name = 'IndexNotBuiltError';
  }
}

let db: DatabaseSync | null = null;

/** Read-only handle for the app. Cached — SQLite is a single local file. */
export function getDb(): DatabaseSync {
  if (db) return db;
  if (!existsSync(SQLITE_PATH)) throw new IndexNotBuiltError(SQLITE_PATH);
  db = new DatabaseSync(SQLITE_PATH, { readOnly: true });
  return db;
}

/** Writable handle for ingest. Applies schema.sql, dropping any existing tables. */
export function createDbForIngest(): DatabaseSync {
  const handle = new DatabaseSync(SQLITE_PATH);
  handle.exec(readFileSync(path.join(process.cwd(), 'lib/schema.sql'), 'utf8'));
  return handle;
}

let lanceTable: Promise<lancedb.Table> | null = null;

export function getChunkTable(): Promise<lancedb.Table> {
  lanceTable ??= (async () => {
    if (!existsSync(LANCE_PATH)) throw new IndexNotBuiltError(LANCE_PATH);
    const connection = await lancedb.connect(LANCE_PATH);
    return connection.openTable(CHUNK_TABLE);
  })();
  return lanceTable;
}

export async function connectLanceForIngest(): Promise<lancedb.Connection> {
  return lancedb.connect(LANCE_PATH);
}

export function indexExists(): boolean {
  return existsSync(SQLITE_PATH) && existsSync(LANCE_PATH);
}
