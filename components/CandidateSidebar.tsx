'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Avatar, ScrollArea } from '@/components/ui/primitives';
import { PdfDialog } from '@/components/PdfDialog';
import type { Candidate } from '@/components/types';

/**
 * PRD §8.4.4 — 280px, one row per candidate, live filter.
 *
 * It is not decoration: it is the answer to "what is actually in this corpus?",
 * which is the first thing anyone evaluating a retrieval demo wants to know.
 */
export function CandidateSidebar({ candidates, error }: { candidates: Candidate[]; error?: string }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Candidate | null>(null);

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
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-border bg-surface">
      <div className="border-b border-border px-3 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h1 className="text-lg font-semibold tracking-tight text-text">CV Screener</h1>
          <span className="font-mono text-xs text-muted">{candidates.length} indexed</span>
        </div>
        <div className="flex items-center gap-2 rounded-[var(--radius)] border border-border bg-bg px-2.5 py-1.5">
          <Search className="size-3.5 shrink-0 text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter candidates"
            aria-label="Filter candidates"
            className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        {error ? (
          <p className="px-3 py-4 text-sm leading-relaxed text-muted">{error}</p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted">No candidate matches “{query}”.</p>
        ) : (
          <ul className="py-1">
            {filtered.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  onClick={() => setOpen(candidate)}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                >
                  <Avatar src={`/api/photo/${candidate.id}`} name={candidate.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-text">{candidate.name}</span>
                    <span className="block truncate text-xs text-muted">{candidate.current_title}</span>
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted">{candidate.years_experience}y</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>

      {open ? (
        <PdfDialog
          candidateId={open.id}
          name={open.name}
          page={1}
          open
          onOpenChange={(value) => !value && setOpen(null)}
        />
      ) : null}
    </aside>
  );
}
