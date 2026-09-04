'use client';

import { COPY } from '@/lib/copy';

/**
 * PRD §8.4.5 and §8.4.7 — the empty state and its suggested questions. The copy,
 * including which questions are seeded, lives in `lib/copy.ts`.
 */
export function SuggestedQuestions({ onPick }: { onPick: (question: string) => void }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {COPY.empty.suggestions.map(({ question, shape, icon: Icon }) => (
        <button
          key={question}
          type="button"
          onClick={() => onPick(question)}
          className="group rounded-[var(--radius)] bg-surface px-3.5 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-faint"
        >
          <span className="block text-sm leading-snug text-text">{question}</span>
          <span className="mt-1.5 flex items-center gap-1.5 font-mono text-xs text-faint">
            <Icon className="size-3" />
            {shape}
          </span>
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  total,
  chunks,
  onPick,
}: {
  total: number;
  chunks?: number;
  onPick: (question: string) => void;
}) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 md:py-20">
      <p className="font-mono text-xs text-faint">
        {total > 0 ? COPY.empty.indexed(total, chunks) : COPY.empty.notBuilt}
      </p>
      <h2 className="mt-3 text-lg text-text">{COPY.empty.heading}</h2>
      <p className="mb-6 mt-2 text-sm leading-relaxed text-muted">{COPY.empty.body}</p>
      <SuggestedQuestions onPick={onPick} />
    </div>
  );
}
