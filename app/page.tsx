'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { UIMessage } from 'ai';
import { LayoutGrid } from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import { ChatPane } from '@/components/ChatPane';
import { cn } from '@/lib/utils';
import {
  getError,
  getServerSnapshot,
  getSnapshot,
  removeSession,
  saveMessages,
  startDraft,
  subscribe,
} from '@/lib/chat-store';
import type { Candidate } from '@/components/types';
import type { ChatMode } from '@/lib/schemas';

interface Meta {
  model: string;
  chunks: number;
}

/**
 * The shell: one inset frame, a breadcrumb bar, the tabbed sidebar, and the
 * active conversation. One screen, no navigation.
 */
export default function Page() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [meta, setMeta] = useState<Meta>();
  const [rosterError, setRosterError] = useState<string>();
  const [mode, setMode] = useState<ChatMode>('agentic');

  const sessions = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const chatsError = useSyncExternalStore(subscribe, getError, () => null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/candidates')
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Failed to load the roster.');
        setCandidates(body.candidates ?? []);
        if (body.meta) setMeta(body.meta);
      })
      .catch((cause: Error) => setRosterError(cause.message));
  }, []);

  // Falling back to the first session means the initial render needs no state:
  // on the server `sessions` is empty, and after hydration it is the draft.
  const active = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? sessions[0] ?? null,
    [sessions, selectedId],
  );

  const handleMessagesChange = useCallback(
    (messages: UIMessage[]) => {
      if (active) saveMessages(active.id, messages);
    },
    [active],
  );

  const handleNewChat = useCallback(() => setSelectedId(startDraft()), []);
  const handleDeleteSession = useCallback((id: string) => setSelectedId(removeSession(id)), []);

  // Saved chats only; an untouched draft has no history worth listing.
  const savedSessions = useMemo(
    () => sessions.filter((session) => session.messages.length > 0),
    [sessions],
  );

  return (
    <div className="h-dvh bg-page p-2.5">
      <div className="flex h-full flex-col overflow-hidden rounded-[14px] bg-bg">
        {/* Breadcrumb bar. The mode toggle lives here because the eval measures
            it — a reviewer can switch and watch the same question lose recall. */}
        <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4">
          <LayoutGrid className="size-4 shrink-0 text-muted" />
          <span className="text-sm text-text">cv-screener</span>
          <span className="text-sm text-faint">/</span>
          <span className="text-sm text-muted">{candidates.length || '—'} CVs</span>
          <span className="text-sm text-faint">/</span>
          <span className="truncate text-sm text-muted">{active?.title ?? 'New chat'}</span>

          <div className="ml-auto flex items-center rounded-full bg-surface p-0.5">
            {(['agentic', 'classic'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                aria-pressed={mode === value}
                className={cn(
                  'rounded-full px-2.5 py-1 text-xs transition-colors',
                  mode === value ? 'bg-surface-2 text-text' : 'text-faint hover:text-muted',
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <Sidebar
            candidates={candidates}
            rosterError={rosterError}
            sessions={savedSessions}
            chatsError={chatsError}
            activeSessionId={active?.id ?? null}
            onSelectSession={setSelectedId}
            onNewChat={handleNewChat}
            onDeleteSession={handleDeleteSession}
          />

          {active ? (
            <ChatPane
              key={active.id}
              initialMessages={active.messages}
              mode={mode}
              candidateCount={candidates.length}
              chunks={meta?.chunks}
              model={meta?.model}
              onMessagesChange={handleMessagesChange}
            />
          ) : (
            <main className="flex-1" />
          )}
        </div>
      </div>
    </div>
  );
}
