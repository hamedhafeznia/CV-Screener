'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { UIMessage } from 'ai';
import { LayoutGrid, PanelLeft, X } from 'lucide-react';
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
import { COPY } from '@/lib/copy';

interface Meta {
  model: string;
  chunks: number;
}

/**
 * The shell: one inset frame, a breadcrumb bar, the sidebar, and the active
 * conversation.
 *
 * The sidebar is a static column from `md` up and a slide-over drawer below it.
 * At 375px a fixed 272px column would leave about a hundred pixels of chat,
 * which is not a narrower version of the layout so much as a broken one.
 */
export default function Page() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [meta, setMeta] = useState<Meta>();
  const [rosterError, setRosterError] = useState<string>();
  const [mode, setMode] = useState<ChatMode>('agentic');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const sessions = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const chatsError = useSyncExternalStore(subscribe, getError, () => null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/candidates')
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? COPY.errors.rosterFailed);
        setCandidates(body.candidates ?? []);
        if (body.meta) setMeta(body.meta);
      })
      .catch((cause: Error) => setRosterError(cause.message));
  }, []);

  // Escape closes the drawer, matching every other overlay on the page.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

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
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Saved chats only; an untouched draft has no history worth listing.
  const savedSessions = useMemo(
    () => sessions.filter((session) => session.messages.length > 0),
    [sessions],
  );

  return (
    <div className="h-dvh bg-page p-0 sm:p-2.5">
      <div className="flex h-full flex-col overflow-hidden bg-bg sm:rounded-[14px]">
        <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-3 sm:px-4">
          <button
            type="button"
            onClick={() => setDrawerOpen((open) => !open)}
            aria-label={drawerOpen ? COPY.header.closeMenu : COPY.header.openMenu}
            aria-expanded={drawerOpen}
            className="-ml-1 flex size-8 items-center justify-center rounded-[var(--radius)] text-muted transition-colors hover:bg-surface hover:text-text md:hidden"
          >
            {drawerOpen ? <X className="size-4" /> : <PanelLeft className="size-4" />}
          </button>

          <LayoutGrid className="hidden size-4 shrink-0 text-muted md:block" />
          <span className="shrink-0 text-sm text-text">{COPY.app.name}</span>

          {/* Breadcrumb detail is the first thing to go when width is scarce. */}
          <span className="hidden text-sm text-faint sm:inline">/</span>
          <span className="hidden shrink-0 text-sm text-muted sm:inline">
            {COPY.header.corpus(candidates.length)}
          </span>
          <span className="hidden text-sm text-faint lg:inline">/</span>
          <span className="hidden truncate text-sm text-muted lg:inline">
            {active?.title ?? COPY.sidebar.newChat}
          </span>

          <div className="ml-auto flex shrink-0 items-center rounded-full bg-surface p-0.5">
            {(['agentic', 'classic'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                aria-pressed={mode === value}
                className={cn(
                  'rounded-full px-2 py-1 text-xs transition-colors sm:px-2.5',
                  mode === value ? 'bg-surface-2 text-text' : 'text-faint hover:text-muted',
                )}
              >
                {COPY.header.modes[value]}
              </button>
            ))}
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1">
          {/* Backdrop, drawer only. */}
          {drawerOpen ? (
            <button
              type="button"
              aria-label={COPY.header.closeMenu}
              onClick={closeDrawer}
              className="absolute inset-0 z-30 bg-black/50 md:hidden"
            />
          ) : null}

          <div
            className={cn(
              'absolute inset-y-0 left-0 z-40 transition-transform duration-200 ease-out md:static md:z-auto md:translate-x-0',
              drawerOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
            )}
          >
            <Sidebar
              candidates={candidates}
              rosterError={rosterError}
              sessions={savedSessions}
              chatsError={chatsError}
              activeSessionId={active?.id ?? null}
              onSelectSession={setSelectedId}
              onNewChat={handleNewChat}
              onDeleteSession={handleDeleteSession}
              onNavigate={closeDrawer}
            />
          </div>

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
