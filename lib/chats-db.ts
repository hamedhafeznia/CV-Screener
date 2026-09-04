import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { z } from 'zod';
import { DATA_DIR } from './stores';

/**
 * Conversation history, stored server-side.
 *
 * Deliberately a *separate* database from `data/candidates.db`. That file is a
 * build artifact: ingest produces it, it is committed to the repo, and it should
 * stay byte-identical to what ingest wrote. Chats are mutable user data with a
 * different lifecycle, so they get their own file, which is gitignored.
 *
 * The schema is `CREATE TABLE IF NOT EXISTS` rather than the drop-and-rebuild
 * `lib/schema.sql` uses, for the same reason: this data is not regenerable.
 */

export const CHATS_DB_PATH = path.join(DATA_DIR, 'chats.db');

/** Bounds on what the API will accept, since the body is client-supplied. */
const MAX_MESSAGES = 400;
const MAX_BYTES = 2_000_000;
export const MAX_CHATS = 100;

export const CHAT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const ChatUpsertSchema = z.object({
  title: z.string().min(1).max(200),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  mode: z.enum(['agentic', 'classic']).optional(),
  /** UIMessage[] — stored opaquely; the client owns its shape. */
  messages: z.array(z.unknown()).max(MAX_MESSAGES),
});

export type ChatUpsert = z.infer<typeof ChatUpsertSchema>;

export interface ChatRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  mode: string | null;
  messages: unknown[];
}

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  const handle = new DatabaseSync(CHATS_DB_PATH);
  handle.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id         TEXT PRIMARY KEY,
      title      TEXT    NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      mode       TEXT,
      messages   TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats(updated_at DESC);
  `);
  db = handle;
  return db;
}

interface Row {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  mode: string | null;
  messages: string;
}

function toRecord(row: Row): ChatRecord {
  let messages: unknown[] = [];
  try {
    const parsed = JSON.parse(row.messages);
    if (Array.isArray(parsed)) messages = parsed;
  } catch {
    // A corrupt row should cost one conversation, not the whole list.
  }
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    mode: row.mode,
    messages,
  };
}

/**
 * Most-recent first. Returns full records including message bodies: at this
 * scale (tens of local conversations) one round-trip is simpler and faster than
 * a summary list plus a fetch per conversation, and it lets the sidebar and the
 * chat pane share a single source of truth.
 */
export function listChats(limit = MAX_CHATS): ChatRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM chats ORDER BY updated_at DESC LIMIT ?')
    .all(limit) as unknown as Row[];
  return rows.map(toRecord);
}

export function getChat(id: string): ChatRecord | null {
  const row = getDb().prepare('SELECT * FROM chats WHERE id = ?').get(id) as unknown as Row | undefined;
  return row ? toRecord(row) : null;
}

export class ChatTooLargeError extends Error {
  constructor() {
    super('Conversation exceeds the maximum stored size.');
    this.name = 'ChatTooLargeError';
  }
}

export function upsertChat(id: string, input: ChatUpsert): ChatRecord {
  const messages = JSON.stringify(input.messages);
  if (messages.length > MAX_BYTES) throw new ChatTooLargeError();

  getDb()
    .prepare(
      `INSERT INTO chats (id, title, created_at, updated_at, mode, messages)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         updated_at = excluded.updated_at,
         mode = excluded.mode,
         messages = excluded.messages`,
    )
    .run(id, input.title, input.createdAt, input.updatedAt, input.mode ?? null, messages);

  // Keep the table bounded so a long-lived local install cannot grow forever.
  getDb()
    .prepare('DELETE FROM chats WHERE id NOT IN (SELECT id FROM chats ORDER BY updated_at DESC LIMIT ?)')
    .run(MAX_CHATS);

  return getChat(id)!;
}

export function deleteChat(id: string): boolean {
  const result = getDb().prepare('DELETE FROM chats WHERE id = ?').run(id);
  return Number(result.changes) > 0;
}
