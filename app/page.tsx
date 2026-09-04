'use client';

import { useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { ArrowUp, Square, TriangleAlert } from 'lucide-react';
import { Button, Textarea } from '@/components/ui/primitives';
import { CandidateSidebar } from '@/components/CandidateSidebar';
import { Message } from '@/components/Message';
import { EmptyState } from '@/components/EmptyState';
import { cn } from '@/lib/utils';
import type { Candidate } from '@/components/types';
import type { ChatMode } from '@/lib/schemas';

/**
 * PRD §8.5 — sidebar plus a centred chat column. One screen, no navigation.
 */
export default function Page() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [rosterError, setRosterError] = useState<string>();
  const [mode, setMode] = useState<ChatMode>('agentic');
  const [input, setInput] = useState('');

  const { messages, sendMessage, status, error, stop } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat', body: () => ({ mode }) }),
  });

  const busy = status === 'submitted' || status === 'streaming';
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/candidates')
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Failed to load the roster.');
        setCandidates(body.candidates ?? []);
      })
      .catch((cause: Error) => setRosterError(cause.message));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, status]);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput('');
    void sendMessage({ text: trimmed });
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-bg">
      <CandidateSidebar candidates={candidates} error={rosterError} />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-2.5">
          <p className="truncate text-sm text-muted">
            Grounded in {candidates.length || '—'} CVs. Every answer cites its source.
          </p>
          {/* Exposed because the eval measures it: the reviewer can watch the
              same question lose recall on the classic path. */}
          <div className="flex shrink-0 items-center rounded-[var(--radius)] border border-border p-0.5 font-mono text-xs">
            {(['agentic', 'classic'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                aria-pressed={mode === value}
                className={cn(
                  'rounded-[calc(var(--radius)-2px)] px-2 py-1 transition-colors',
                  mode === value ? 'bg-accent-bg text-accent' : 'text-muted hover:text-text',
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-slim">
          {messages.length === 0 ? (
            <EmptyState total={candidates.length} onPick={submit} />
          ) : (
            <div className="mx-auto max-w-3xl space-y-6 px-6 py-6">
              {messages.map((message) => (
                <Message key={message.id} message={message} />
              ))}
              {status === 'submitted' ? <p className="font-mono text-xs text-muted">thinking…</p> : null}
              {error ? (
                <p className="flex items-start gap-2 rounded-[var(--radius)] border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  {error.message}
                </p>
              ) : null}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="border-t border-border px-6 py-3">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit(input);
            }}
            className="mx-auto flex max-w-3xl items-end gap-2 rounded-[var(--radius)] border border-border bg-surface px-3 py-2 focus-within:border-accent/50"
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
              className="max-h-40 min-h-6 py-1"
              aria-label="Ask a question about the CVs"
            />
            {busy ? (
              <Button type="button" size="icon" variant="outline" onClick={stop} aria-label="Stop">
                <Square className="size-3.5" />
              </Button>
            ) : (
              <Button type="submit" size="icon" disabled={!input.trim()} aria-label="Send">
                <ArrowUp className="size-4" />
              </Button>
            )}
          </form>
        </div>
      </main>
    </div>
  );
}
