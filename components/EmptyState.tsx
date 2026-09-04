'use client';

import { Database, Filter, Search, FileText } from 'lucide-react';

/**
 * PRD §8.4.5 and §8.4.7. The suggested questions are seeded with the three from
 * the brief, so the first thing anyone does with this app is the exact thing it
 * was built to do — no typing, no guessing at phrasing.
 */
export const SUGGESTED_QUESTIONS: { question: string; shape: string; icon: typeof Search }[] = [
  { question: 'Who has experience with Python?', shape: 'aggregation over the corpus', icon: Filter },
  { question: 'Which candidate graduated from UPC?', shape: 'exact match on an acronym', icon: Filter },
  { question: 'Summarize the profile of the most senior data engineer.', shape: 'whole-document fetch', icon: FileText },
  { question: 'Who has scaled a platform team and worked with Kubernetes?', shape: 'semantic search', icon: Search },
];

export function SuggestedQuestions({ onPick }: { onPick: (question: string) => void }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {SUGGESTED_QUESTIONS.map(({ question, shape, icon: Icon }) => (
        <button
          key={question}
          type="button"
          onClick={() => onPick(question)}
          className="group rounded-[var(--radius)] border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent/40 hover:bg-accent-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="block text-sm leading-snug text-text">{question}</span>
          <span className="mt-1 flex items-center gap-1.5 font-mono text-xs text-muted">
            <Icon className="size-3" />
            {shape}
          </span>
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ total, onPick }: { total: number; onPick: (question: string) => void }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <div className="mb-1.5 flex items-center gap-2 font-mono text-xs text-muted">
        <Database className="size-3.5" />
        {total > 0 ? `${total} CVs indexed · SQLite + LanceDB` : 'index not built'}
      </div>
      <h2 className="text-lg font-semibold tracking-tight text-text">Ask about the candidates.</h2>
      <p className="mb-5 mt-1 max-w-xl text-sm leading-relaxed text-muted">
        Answers come only from the indexed CVs. The model picks its own retriever for each question —
        an exact SQL filter, semantic search, or a whole-document fetch — and every answer cites the
        PDF and page it came from.
      </p>
      <SuggestedQuestions onPick={onPick} />
    </div>
  );
}
