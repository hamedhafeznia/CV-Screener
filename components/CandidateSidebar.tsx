'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, ScrollArea } from '@/components/ui/primitives';
import { PdfDialog } from '@/components/PdfDialog';
import type { Candidate } from '@/components/types';

/**
 * PRD §8.4.4 — one row per candidate, live filter, click to open the CV.
 *
 * Not decoration: it answers "what is actually in this corpus?", which is the
 * first thing anyone evaluating a retrieval demo wants to know, and it keeps the
 * generated headshots in view so the faces in the citations are recognisable.
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
    <aside className="flex w-[272px] shrink-0 flex-col border-r border-border">
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">Candidates</span>
        <span className="font-mono text-[11px] text-faint tabular-nums">{candidates.length}</span>
      </div>

      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-[var(--radius)] px-2 py-1.5 transition-colors focus-within:bg-surface">
          <Search className="size-3.5 shrink-0 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter"
            aria-label="Filter candidates"
            className="w-full bg-transparent text-sm text-text outline-none"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        {error ? (
          <p className="px-5 py-3 text-sm leading-relaxed text-faint">{error}</p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-3 text-sm text-faint">
            {candidates.length === 0 ? 'No index built yet.' : `Nothing matches “${query}”.`}
          </p>
        ) : (
          <ul className="px-2 pb-4">
            {filtered.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  onClick={() => setOpen(candidate)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-[var(--radius)] px-3 py-2 text-left transition-colors',
                    'hover:bg-surface focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-faint',
                    open?.id === candidate.id && 'bg-surface',
                  )}
                >
                  <Avatar src={`/api/photo/${candidate.id}`} name={candidate.name} className="saturate-[0.7]" />
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
