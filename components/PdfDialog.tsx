'use client';

import { ExternalLink } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/primitives';

/**
 * The citation viewer (PRD §8.4.6). Opens the real PDF at the cited page — the
 * `#page=` fragment is honoured by every built-in browser PDF viewer, which is
 * why this is an iframe and not a rendered canvas.
 */
export function PdfDialog({
  candidateId,
  name,
  page,
  open,
  onOpenChange,
}: {
  candidateId: string;
  name: string;
  page: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const src = `/api/cv/${candidateId}#page=${page}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={name} description={`${candidateId}.pdf · page ${page}`} className="h-[92vh]">
        <iframe src={src} title={`${name} CV, page ${page}`} className="min-h-0 w-full flex-1 bg-surface-2" />
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted">
          <span>Cited from page {page}</span>
          <a
            href={`/api/cv/${candidateId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            Open in new tab <ExternalLink className="size-3" />
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
