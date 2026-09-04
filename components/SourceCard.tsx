'use client';

import { useState } from 'react';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PdfDialog } from '@/components/PdfDialog';
import type { Citation } from '@/components/types';
import { COPY } from '@/lib/copy';

/**
 * Secondary tier (PRD §8.3): a row of compact chips under the answer, one per
 * cited document, each opening the real PDF at the cited page.
 *
 * Chips rather than cards because a corpus-wide question can cite nineteen
 * candidates — nineteen cards would bury the answer they belong to, while
 * nineteen chips stay a readable footnote.
 */
export function SourceChip({ citation }: { citation: Citation }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={COPY.sources.chipTitle(citation.name, citation.current_title, citation.page)}
        className={cn(
          'group inline-flex max-w-full items-center gap-2 rounded-[var(--radius)] bg-surface px-2.5 py-1.5',
          'transition-colors hover:bg-surface-2 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-faint',
        )}
      >
        <FileText className="size-3.5 shrink-0 text-faint transition-colors group-hover:text-muted" />
        <span className="truncate font-mono text-xs text-muted transition-colors group-hover:text-text">
          {citation.candidate_id}
        </span>
        <span className="truncate text-xs text-faint">{citation.name}</span>
        {citation.page > 1 ? (
          <span className="shrink-0 font-mono text-xs text-faint">{COPY.sources.page(citation.page)}</span>
        ) : null}
      </button>

      <PdfDialog
        candidateId={citation.candidate_id}
        name={citation.name}
        page={citation.page}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

export function SourceGrid({ citations }: { citations: Citation[] }) {
  const [showAll, setShowAll] = useState(false);
  if (citations.length === 0) return null;

  const LIMIT = 12;
  const shown = showAll ? citations : citations.slice(0, LIMIT);
  const hidden = citations.length - shown.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((citation) => (
        <SourceChip key={`${citation.candidate_id}:${citation.page}`} citation={citation} />
      ))}
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="rounded-[var(--radius)] px-2.5 py-1.5 text-xs text-faint transition-colors hover:text-muted"
        >
          {COPY.sources.more(hidden)}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Placeholder chips while retrieval is in flight. Holding the space stops the
 * answer from jumping down the page when the real sources land.
 */
export function SourceSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-hidden>
      {[104, 132, 118].map((width, i) => (
        <div key={i} className="skeleton h-[30px] rounded-[var(--radius)]" style={{ width }} />
      ))}
    </div>
  );
}
