'use client';

import { useMemo, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, ScrollArea } from '@/components/ui/primitives';
import { PdfDialog } from '@/components/PdfDialog';
import { relativeTime, type ChatSession } from '@/lib/chat-store';
import type { Candidate } from '@/components/types';

export type SidebarTab = 'resumes' | 'chats';

/**
 * Two panes behind one set of tabs: the corpus, and the conversation history.
 *
 * Resumes answers "what is actually in this index?", which is the first thing
 * anyone evaluating a retrieval demo wants to know. Chats keeps prior questions
 * one click away, which matters because the interesting comparisons here are
 * between answers — the same question in agentic and classic mode, say.
 */
export function Sidebar({
  candidates,
  rosterError,
  sessions,
  chatsError,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  onNavigate,
}: {
  candidates: Candidate[];
  rosterError?: string;
  sessions: ChatSession[];
  chatsError?: string | null;
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
  /** Called after any navigation, so the mobile drawer can close itself. */
  onNavigate?: () => void;
}) {
  const [tab, setTab] = useState<SidebarTab>('resumes');
  const [query, setQuery] = useState('');
  const [openCv, setOpenCv] = useState<Candidate | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return candidates;
    return candidates.filter((candidate) =>
      [candidate.name, candidate.current_title, candidate.location, candidate.id]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [candidates, query]);

  return (
    <aside className="flex h-full w-[272px] shrink-0 flex-col border-r border-border bg-bg">
      <div className="flex items-center gap-1 px-3 pb-1 pt-3">
        {(
          [
            ['resumes', 'Resumes'],
            ['chats', 'Chats'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            aria-pressed={tab === value}
            className={cn(
              'rounded-[var(--radius)] px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] transition-colors',
              tab === value ? 'bg-surface text-text' : 'text-faint hover:text-muted',
            )}
          >
            {label}
          </button>
        ))}

        <span className="ml-auto">
          {tab === 'resumes' ? (
            <span className="pr-2 font-mono text-[11px] text-faint tabular-nums">{candidates.length}</span>
          ) : (
            <button
              type="button"
              onClick={() => {
                onNewChat();
                onNavigate?.();
              }}
              aria-label="New chat"
              title="New chat"
              className="flex size-6 items-center justify-center rounded-[var(--radius)] text-faint transition-colors hover:bg-surface hover:text-text"
            >
              <Plus className="size-3.5" />
            </button>
          )}
        </span>
      </div>

      {tab === 'resumes' ? (
        <ResumesPane
          candidates={filtered}
          total={candidates.length}
          query={query}
          onQuery={setQuery}
          error={rosterError}
          openCv={openCv}
          onOpenCv={(candidate) => {
            setOpenCv(candidate);
            if (candidate) onNavigate?.();
          }}
        />
      ) : (
        <ChatsPane
          sessions={sessions}
          error={chatsError}
          activeId={activeSessionId}
          onSelect={(id) => {
            onSelectSession(id);
            onNavigate?.();
          }}
          onDelete={onDeleteSession}
        />
      )}
    </aside>
  );
}

/* --------------------------------------------------------------- resumes --- */

function ResumesPane({
  candidates,
  total,
  query,
  onQuery,
  error,
  openCv,
  onOpenCv,
}: {
  candidates: Candidate[];
  total: number;
  query: string;
  onQuery: (value: string) => void;
  error?: string;
  openCv: Candidate | null;
  onOpenCv: (candidate: Candidate | null) => void;
}) {
  return (
    <>
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-[var(--radius)] px-2 py-1.5 transition-colors focus-within:bg-surface">
          <Search className="size-3.5 shrink-0 text-faint" />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Filter"
            aria-label="Filter candidates"
            className="w-full bg-transparent text-sm text-text outline-none"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        {error ? (
          <p className="px-5 py-3 text-sm leading-relaxed text-faint">{error}</p>
        ) : candidates.length === 0 ? (
          <p className="px-5 py-3 text-sm text-faint">
            {total === 0 ? 'No index built yet.' : `Nothing matches “${query}”.`}
          </p>
        ) : (
          <ul className="px-2 pb-4">
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  onClick={() => onOpenCv(candidate)}
                  className="flex w-full items-center gap-2.5 rounded-[var(--radius)] px-3 py-2 text-left transition-colors hover:bg-surface focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-faint"
                >
                  <Avatar
                    src={`/api/photo/${candidate.id}`}
                    name={candidate.name}
                    className="saturate-[0.7]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm leading-tight text-text">{candidate.name}</span>
                    <span className="mt-0.5 block truncate text-xs leading-tight text-faint">
                      {candidate.current_title}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-faint tabular-nums">
                    {candidate.years_experience}y
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>

      {openCv ? (
        <PdfDialog
          candidateId={openCv.id}
          name={openCv.name}
          page={1}
          open
          onOpenChange={(value) => !value && onOpenCv(null)}
        />
      ) : null}
    </>
  );
}

/* ----------------------------------------------------------------- chats --- */

function ChatsPane({
  sessions,
  error,
  activeId,
  onSelect,
  onDelete,
}: {
  sessions: ChatSession[];
  error?: string | null;
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (error) {
    return (
      <ScrollArea className="flex-1">
        <p className="px-5 py-3 text-sm leading-relaxed text-danger">
          Chat history unavailable: {error}
        </p>
      </ScrollArea>
    );
  }

  if (sessions.length === 0) {
    return (
      <ScrollArea className="flex-1">
        <p className="px-5 py-3 text-sm leading-relaxed text-faint">
          No saved chats yet. Ask a question and it will appear here.
        </p>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <ul className="px-2 pb-4">
        {sessions.map((session) => (
          <li key={session.id}>
            <div
              className={cn(
                'group relative flex items-center rounded-[var(--radius)] transition-colors',
                activeId === session.id ? 'bg-surface' : 'hover:bg-surface',
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(session.id)}
                className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-faint"
              >
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-sm leading-tight',
                    activeId === session.id ? 'text-text' : 'text-muted',
                  )}
                >
                  {session.title}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-faint tabular-nums group-hover:invisible">
                  {relativeTime(session.updatedAt)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(session.id)}
                aria-label={`Delete chat: ${session.title}`}
                className="invisible absolute right-1.5 flex size-6 items-center justify-center rounded-[var(--radius)] text-faint transition-colors hover:bg-surface-2 hover:text-text group-hover:visible"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}
