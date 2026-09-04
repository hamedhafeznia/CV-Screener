import type { UIMessage } from 'ai';

/**
 * Conversation history, exposed to React as an external store.
 *
 * This module is the only place that knows *where* chats live — the same seam
 * `lib/llm.ts` provides for the model provider. It was localStorage first and is
 * now `/api/chats` backed by `data/chats.db`; nothing else in the UI changed.
 *
 * Shaped for `useSyncExternalStore` rather than loaded through an effect: React
 * gets a stable server snapshot (empty) and a lazily-hydrated client one, which
 * avoids both the hydration mismatch and the cascading render that reading into
 * state during an effect would cause.
 *
 * Writes are optimistic. The local cache updates immediately and the PUT follows,
 * so a slow disk never shows up as input lag; a failed write leaves the in-memory
 * conversation intact and is reported through `getError()`.
 */

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: UIMessage[];
}

interface ChatDto {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: unknown[];
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
let hydrating = false;
let error: string | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

function commit(next: ChatSession[]): void {
  cache = next;
  emit();
}

/** Lazy hydrate. Always leaves at least one draft to land on. */
function ensure(): ChatSession[] {
  if (cache === null) {
    cache = [createSession()];
    if (typeof window !== 'undefined' && !hydrating) {
      hydrating = true;
      void hydrate();
    }
  }
  return cache;
}

async function hydrate(): Promise<void> {
  try {
    const response = await fetch('/api/chats');
    const body = (await response.json()) as { chats?: ChatDto[]; error?: string };
    if (body.error) error = body.error;

    const saved: ChatSession[] = (body.chats ?? []).map((chat) => ({
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      messages: chat.messages as UIMessage[],
    }));

    // Keep whatever draft the user is already sitting in, then append history.
    const drafts = (cache ?? []).filter((s) => s.messages.length === 0);
    commit([...drafts, ...saved.filter((s) => !drafts.some((d) => d.id === s.id))]);
  } catch (cause) {
    error = (cause as Error).message;
    emit();
  } finally {
    hydrating = false;
  }
}

async function put(session: ChatSession): Promise<void> {
  try {
    const response = await fetch(`/api/chats/${session.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messages: session.messages,
      }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      error = body.error ?? `Failed to save chat (${response.status}).`;
      emit();
    } else if (error) {
      error = null;
      emit();
    }
  } catch (cause) {
    error = (cause as Error).message;
    emit();
  }
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

/** Non-fatal storage problems, surfaced in the sidebar rather than thrown. */
export function getError(): string | null {
  return error;
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
  if (updated.messages.length > 0) void put(updated);
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
  const existing = ensure().find((s) => s.id === id);
  const remaining = ensure().filter((s) => s.id !== id);
  const next = remaining.length > 0 ? remaining : [createSession()];
  commit(next);

  // Only saved conversations exist server-side; an unsaved draft has no row.
  if (existing && existing.messages.length > 0) {
    void fetch(`/api/chats/${id}`, { method: 'DELETE' }).catch(() => {
      /* The row survives; the next hydrate will bring it back. */
    });
  }
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
