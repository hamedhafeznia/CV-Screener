'use client';

import { useState } from 'react';
import { FileText } from 'lucide-react';
import { Avatar, Badge } from '@/components/ui/primitives';
import { PdfDialog } from '@/components/PdfDialog';
import type { Citation } from '@/components/types';

/**
 * Secondary tier (PRD §8.3): bordered, accent-tinted, clickable.
 *
 * Reuses the generated headshot, which closes the loop between the generation
 * pipeline and the interface — the face in the citation is the face in the PDF
 * it opens.
 */
export function SourceCard({ citation }: { citation: Citation }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-full items-center gap-2.5 rounded-[var(--radius)] border border-border bg-accent-bg/50 px-2.5 py-2 text-left transition-colors hover:border-accent/40 hover:bg-accent-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <Avatar src={`/api/photo/${citation.candidate_id}`} name={citation.name} className="size-9" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-text">{citation.name}</span>
          <span className="block truncate text-xs text-muted">
            {citation.detail ? `${citation.current_title} · ${citation.detail}` : citation.current_title}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <Badge className="group-hover:border-accent/40">p.{citation.page}</Badge>
          <FileText className="size-3.5 text-muted transition-colors group-hover:text-accent" />
        </span>
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
  if (citations.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="mb-1.5 font-mono text-xs text-muted">
        {citations.length} source{citations.length === 1 ? '' : 's'}
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {citations.map((citation) => (
          <SourceCard key={`${citation.candidate_id}:${citation.page}`} citation={citation} />
        ))}
      </div>
    </div>
  );
}
