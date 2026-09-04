import type { UIMessage } from 'ai';

/**
 * Client-side chat persistence, exposed as an external store.
 *
 * The chat API is stateless by design (PRD §7.5) — the client holds the history
 * and posts the whole array each turn — so saving conversations needs no server
 * involvement at all. Keeping them in localStorage also means chat writes never
 * touch `data/candidates.db`, which is a committed build artifact and should
 * stay byte-identical to what ingest produced.
 *
 * Shaped for `useSyncExternalStore` rather than loaded through an effect: React
 * gets a stable server snapshot (empty) and a lazily-hydrated client one, which
 * avoids both the hydration mismatch and the cascading render that reading
 * storage into state during an effect would cause.
 */

const KEY = 'cv-screener.chats.v1';

/** Enough to browse recent work without risking the ~5 MB storage budget. */
const MAX_SESSIONS = 40;

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: UIMessage[];
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function newSessionId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createSession(): ChatSession {
  const now = Date.now();
  return { id: newSessionId(), title: 'New chat', createdAt: now, updatedAt: now, messages: [] };
}

/** First user message, trimmed to something that fits a 272px sidebar. */
export function deriveTitle(messages: UIMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  const text = first?.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join(' ')
    .trim();
  if (!text) return 'New chat';
  return text.length > 44 ? `${text.slice(0, 43).trimEnd()}…` : text;
}

/* ----------------------------------------------------------------- store --- */

const EMPTY: ChatSession[] = [];
const listeners = new Set<() => void>();

/** Null until first read. Every mutation replaces it, so the ref is the version. */
let cache: ChatSession[] | null = null;

function readStorage(): ChatSession[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatSession[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => s && typeof s.id === 'string' && Array.isArray(s.messages))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    // Corrupt or unreadable storage is not worth failing the app over.
    return [];
  }
}

function writeStorage(sessions: ChatSession[]): void {
  if (!isBrowser()) return;
  // Never store an untouched draft — an empty session on every page load would
  // otherwise accumulate in the list.
  const keep = sessions.filter((s) => s.messages.length > 0).slice(0, MAX_SESSIONS);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(keep));
  } catch {
    // Quota exceeded: drop the oldest half and try once more before giving up.
    try {
      window.localStorage.setItem(KEY, JSON.stringify(keep.slice(0, Math.ceil(keep.length / 2))));
    } catch {
      /* Storage is unavailable; the in-memory sessions still work. */
    }
  }
}

/** Lazy hydrate. Always leaves at least one draft to land on. */
function ensure(): ChatSession[] {
  if (cache === null) {
    const stored = isBrowser() ? readStorage() : [];
    cache = [createSession(), ...stored];
  }
  return cache;
}

function commit(next: ChatSession[]): void {
  cache = next;
  writeStorage(next);
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): ChatSession[] {
  return ensure();
}

export function getServerSnapshot(): ChatSession[] {
  return EMPTY;
}

/** Record a turn. Names the session from its first question, and bumps it to the top. */
export function saveMessages(id: string, messages: UIMessage[]): void {
  const sessions = ensure();
  const current = sessions.find((s) => s.id === id);
  if (!current) return;
  if (current.messages === messages) return;
  if (current.messages.length === 0 && messages.length === 0) return;

  const updated: ChatSession = {
    ...current,
    messages,
    title: current.title === 'New chat' ? deriveTitle(messages) : current.title,
    updatedAt: messages.length > 0 ? Date.now() : current.updatedAt,
  };
  commit([updated, ...sessions.filter((s) => s.id !== id)]);
}

/** Returns the id to make active — reusing an existing empty draft if there is one. */
export function startDraft(): string {
  const sessions = ensure();
  const draft = sessions.find((s) => s.messages.length === 0);
  if (draft) return draft.id;
  const created = createSession();
  commit([created, ...sessions]);
  return created.id;
}

/** Returns the id to make active once `id` is gone. */
export function removeSession(id: string): string {
  const remaining = ensure().filter((s) => s.id !== id);
  const next = remaining.length > 0 ? remaining : [createSession()];
  commit(next);
  return next[0].id;
}

/** "now", "3m", "2h", "1d" — the compact form the sidebar has room for. */
export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.round(days / 7)}w`;
}
