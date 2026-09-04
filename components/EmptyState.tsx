'use client';

import { Filter, FileText, Search } from 'lucide-react';

/**
 * PRD §8.4.5 and §8.4.7. The suggestions are seeded with the questions from the
 * brief, so the first thing anyone does with the app is the exact thing it was
 * built to do — and each is labelled with the retrieval shape it exercises,
 * which is the point being demonstrated.
 */
export const SUGGESTED_QUESTIONS: { question: string; shape: string; icon: typeof Search }[] = [
  { question: 'Who has experience with Python?', shape: 'aggregation over the corpus', icon: Filter },
  { question: 'Which candidate graduated from UPC?', shape: 'exact match on an acronym', icon: Filter },
  { question: 'Summarize the profile of Xavier Prieto.', shape: 'whole-document fetch', icon: FileText },
  { question: 'Who has scaled a platform team with Kubernetes?', shape: 'semantic search', icon: Search },
];

export function SuggestedQuestions({ onPick }: { onPick: (question: string) => void }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {SUGGESTED_QUESTIONS.map(({ question, shape, icon: Icon }) => (
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
    <div className="mx-auto max-w-2xl px-6 py-20">
      <p className="font-mono text-xs text-faint">
        {total > 0 ? `${total} CVs · ${chunks ?? '—'} chunks · SQLite + LanceDB` : 'index not built'}
      </p>
      <h2 className="mt-3 text-lg text-text">Ask about the candidates.</h2>
      <p className="mb-6 mt-2 text-sm leading-relaxed text-muted">
        Answers come only from the indexed CVs. The model picks its own retriever for each question — an
        exact SQL filter, semantic search, or a whole-document fetch — and every answer cites the PDF and
        page it came from.
      </p>
      <SuggestedQuestions onPick={onPick} />
    </div>
  );
}
