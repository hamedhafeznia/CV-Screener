'use client';

import { useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { ArrowUp, LayoutGrid, Square, TriangleAlert } from 'lucide-react';
import { Button, Textarea } from '@/components/ui/primitives';
import { CandidateSidebar } from '@/components/CandidateSidebar';
import { Message } from '@/components/Message';
import { EmptyState } from '@/components/EmptyState';
import { cn } from '@/lib/utils';
import type { Candidate } from '@/components/types';
import type { ChatMode } from '@/lib/schemas';

interface Meta {
  model: string;
  chunks: number;
}

/**
 * The shell: a single inset frame, a breadcrumb bar, the roster, and the chat.
 * One screen, no navigation — everything the reviewer needs is already visible.
 */
export default function Page() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [meta, setMeta] = useState<Meta>();
  const [rosterError, setRosterError] = useState<string>();
  const [mode, setMode] = useState<ChatMode>('agentic');
  const [input, setInput] = useState('');
  /** Wall-clock per answer, shown in the tool trace. */
  const [durations, setDurations] = useState<Record<string, number>>({});

  const { messages, sendMessage, status, error, stop } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat', body: () => ({ mode }) }),
  });

  const busy = status === 'submitted' || status === 'streaming';
  const bottomRef = useRef<HTMLDivElement>(null);
  const startedAt = useRef<number | null>(null);

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

  // Stamp each assistant turn with how long it took, once it stops streaming.
  useEffect(() => {
    if (busy) return;
    const last = messages.at(-1);
    if (!last || last.role !== 'assistant' || startedAt.current === null) return;
    const elapsed = (Date.now() - startedAt.current) / 1000;
    startedAt.current = null;
    setDurations((previous) => (last.id in previous ? previous : { ...previous, [last.id]: elapsed }));
  }, [busy, messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, status]);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    startedAt.current = Date.now();
    setInput('');
    void sendMessage({ text: trimmed });
  };

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
          <span className="text-sm text-muted">{mode}</span>
          <span
            className={cn('size-1.5 rounded-full transition-colors', busy ? 'bg-text' : 'bg-faint')}
            aria-label={busy ? 'retrieving' : 'idle'}
          />

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
          <CandidateSidebar candidates={candidates} error={rosterError} />

          <main className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-slim">
              {messages.length === 0 ? (
                <EmptyState total={candidates.length} chunks={meta?.chunks} onPick={submit} />
              ) : (
                <div className="mx-auto max-w-3xl space-y-8 px-8 py-8">
                  {messages.map((message) => (
                    <Message
                      key={message.id}
                      message={message}
                      seconds={durations[message.id]}
                      streaming={busy && message === messages.at(-1)}
                    />
                  ))}
                  {status === 'submitted' ? <p className="text-xs text-faint">Retrieving…</p> : null}
                  {error ? (
                    <p className="flex items-start gap-2 rounded-[var(--radius)] bg-surface px-3.5 py-2.5 text-sm text-danger">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                      {error.message}
                    </p>
                  ) : null}
                  <div ref={bottomRef} />
                </div>
              )}
            </div>

            <div className="px-8 pb-6">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  submit(input);
                }}
                className="mx-auto max-w-3xl rounded-[var(--radius-lg)] bg-surface px-4 pb-3 pt-3.5"
              >
                <Textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      submit(input);
                    }
                  }}
                  rows={1}
                  placeholder="Ask about skills, universities, languages, or one candidate…"
                  className="max-h-44 min-h-6"
                  aria-label="Ask a question about the CVs"
                />
                <div className="mt-3 flex items-end justify-between gap-3">
                  <span className="truncate text-xs text-faint">
                    {meta?.model ?? '—'}
                    <span className="ml-2 text-surface-2">·</span>
                    <span className="ml-2">{meta?.chunks ?? '—'} chunks</span>
                  </span>
                  {busy ? (
                    <Button type="button" size="icon" variant="outline" onClick={stop} aria-label="Stop">
                      <Square className="size-3" />
                    </Button>
                  ) : (
                    <Button type="submit" size="icon" disabled={!input.trim()} aria-label="Send">
                      <ArrowUp className="size-4" />
                    </Button>
                  )}
                </div>
              </form>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
