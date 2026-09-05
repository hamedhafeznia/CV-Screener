'use client';

import { useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { ArrowUp, Square, TriangleAlert } from 'lucide-react';
import { Button, Textarea } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { Message } from '@/components/Message';
import { Thinking } from '@/components/Thinking';
import { EmptyState } from '@/components/EmptyState';
import type { ChatMode } from '@/lib/schemas';
import { COPY } from '@/lib/copy';

/**
 * One conversation.
 *
 * Mounted with `key={sessionId}` by the page, so switching chats tears this down
 * and rebuilds it. That is deliberate: `useChat` owns streaming state, and
 * resetting it by remount is far less error-prone than trying to swap the
 * message array out from under an in-flight stream.
 */
export function ChatPane({
  initialMessages,
  mode,
  onModeChange,
  candidateCount,
  chunks,
  model,
  onMessagesChange,
}: {
  initialMessages: UIMessage[];
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  candidateCount: number;
  chunks?: number;
  model?: string;
  onMessagesChange: (messages: UIMessage[]) => void;
}) {
  const [input, setInput] = useState('');
  /** Wall-clock per answer, shown in the tool trace. */
  const [durations, setDurations] = useState<Record<string, number>>({});

  const { messages, sendMessage, status, error, stop } = useChat({
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: '/api/chat', body: () => ({ mode }) }),
  });

  const busy = status === 'submitted' || status === 'streaming';
  const bottomRef = useRef<HTMLDivElement>(null);
  const startedAt = useRef<number | null>(null);

  const savedCount = useRef(-1);

  /**
   * Persist when the conversation *grows* and again when it settles.
   *
   * Saving only on settle would lose the question entirely if the answer never
   * arrives — a rate-limit stall, a closed tab — which is exactly when you most
   * want it back. Keying the mid-flight save on message count rather than
   * content means a streaming answer costs one write when it starts, not one
   * per token.
   */
  useEffect(() => {
    const grew = messages.length !== savedCount.current;
    if (busy && !grew) return;
    savedCount.current = messages.length;
    onMessagesChange(messages);
  }, [busy, messages, onMessagesChange]);

  // Stamp each assistant turn with how long it took, once it stops streaming.
  useEffect(() => {
    if (busy) return;
    const last = messages.at(-1);
    if (!last || last.role !== 'assistant' || startedAt.current === null) return;
    const elapsed = (Date.now() - startedAt.current) / 1000;
    startedAt.current = null;
    setDurations((previous) => (last.id in previous ? previous : { ...previous, [last.id]: elapsed }));
  }, [busy, messages]);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);

  /**
   * Follow the stream only while the reader is already at the bottom. Yanking
   * the viewport back down while someone is scrolled up re-reading an earlier
   * answer is the single most irritating thing a streaming chat can do.
   */
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onScroll = () => {
      const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      setFollowing(distance < 120);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!following) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [following, messages, status]);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    startedAt.current = Date.now();
    setInput('');
    setFollowing(true);
    void sendMessage({ text: trimmed });
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-slim">
        {messages.length === 0 ? (
          <EmptyState total={candidateCount} chunks={chunks} onPick={submit} />
        ) : (
          <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:space-y-8 sm:px-6 md:px-8 md:py-8">
            {messages.map((message) => (
              <div key={message.id} className="rise">
                <Message
                  message={message}
                  seconds={durations[message.id]}
                  streaming={busy && message === messages.at(-1)}
                  model={model}
                />
              </div>
            ))}
            {/* Between send and the first streamed part there is no assistant
                message yet, so the pending state is rendered here — anchored
                where the answer itself will appear, not as a detached line. */}
            {busy && messages.at(-1)?.role === 'user' ? (
              <Thinking
                phase={{ label: COPY.thinking.asking(model ?? COPY.thinking.unknownModel), source: 'model' }}
              />
            ) : null}
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

      <div className="px-3 pb-4 sm:px-6 sm:pb-5 md:px-8 md:pb-6">
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
            placeholder={COPY.chat.inputPlaceholder}
            className="max-h-44 min-h-6"
            aria-label={COPY.chat.inputLabel}
          />
          <div className="mt-3 flex items-end justify-between gap-3">
            {/* Configuration, not navigation: the retrieval mode sits with the
                model name and index size rather than in the header. Classic is
                a deliberately degraded baseline, so it belongs where a reader
                already expects technical detail — not as the app's most
                prominent control. */}
            <span className="flex min-w-0 items-center text-xs text-faint">
              <span className="truncate">{COPY.chat.meta(model, chunks).model}</span>
              <span className="mx-2 text-surface-2">·</span>
              <span className="hidden shrink-0 sm:inline">{COPY.chat.meta(model, chunks).chunks}</span>
              <span className="mx-2 hidden text-surface-2 sm:inline">·</span>
              <span className="flex shrink-0 items-center gap-1.5">
                {(['agentic', 'classic'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onModeChange(value)}
                    aria-pressed={mode === value}
                    title={COPY.chat.modeHint[value]}
                    className={cn(
                      'rounded-full px-1.5 py-0.5 transition-colors',
                      mode === value ? 'bg-surface-2 text-text' : 'text-faint hover:text-muted',
                    )}
                  >
                    {COPY.header.modes[value]}
                  </button>
                ))}
              </span>
            </span>
            {busy ? (
              <Button type="button" size="icon" variant="outline" onClick={stop} aria-label={COPY.chat.stop}>
                <Square className="size-3" />
              </Button>
            ) : (
              <Button type="submit" size="icon" disabled={!input.trim()} aria-label={COPY.chat.send}>
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
        </form>
      </div>
    </main>
  );
}
