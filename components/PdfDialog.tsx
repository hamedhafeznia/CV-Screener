'use client';

import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/primitives';
import { COPY } from '@/lib/copy';

/**
 * The citation viewer (PRD §8.4.6). Opens the real PDF at the cited page — the
 * `#page=` fragment is honoured by every built-in browser PDF viewer, which is
 * why this is an iframe and not a rendered canvas.
 */

/**
 * The frame and its loading state.
 *
 * Split out so it can be keyed on the document it is showing: pointing it at a
 * new CV remounts it, which re-arms the skeleton without resetting state from an
 * effect. A CV is a couple of hundred KB and the browser's PDF plugin takes a
 * moment to boot — without the skeleton the dialog opens onto an empty grey
 * rectangle, which reads as broken rather than loading.
 */
function PdfFrame({ candidateId, name, page }: { candidateId: string; name: string; page: number }) {
  const [loaded, setLoaded] = useState(false);

  /**
   * Safety net. Browsers are inconsistent about firing `load` on an iframe
   * handed to a native PDF plugin, and a skeleton stuck over an already-rendered
   * document is worse than no skeleton at all. A cached CV resolves in
   * milliseconds, so this only ever fires when something has gone quiet.
   */
  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 2500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <div className="relative min-h-0 flex-1 bg-surface">
        {!loaded ? (
          <div className="absolute inset-0 flex items-start justify-center overflow-hidden p-6" aria-hidden>
            {/* Roughly page-shaped, so the real CV does not visibly resize on arrival. */}
            <div className="w-[min(560px,100%)] space-y-3 rounded-[var(--radius)] bg-bg/40 p-8">
              <div className="skeleton h-6 w-1/2" />
              <div className="skeleton h-3 w-2/3" />
              <div className="h-4" />
              <div className="skeleton h-3 w-full" />
              <div className="skeleton h-3 w-[92%]" />
              <div className="skeleton h-3 w-[78%]" />
              <div className="h-4" />
              <div className="skeleton h-3 w-[88%]" />
              <div className="skeleton h-3 w-[64%]" />
            </div>
          </div>
        ) : null}
        <iframe
          src={`/api/cv/${candidateId}#page=${page}`}
          title={COPY.pdf.frameTitle(name, page)}
          onLoad={() => setLoaded(true)}
          className="relative size-full"
        />
      </div>

      <div className="flex items-center justify-between px-4 py-2 text-xs text-faint">
        <span>{loaded ? COPY.pdf.cited(page) : COPY.pdf.loading}</span>
        <a
          href={`/api/cv/${candidateId}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-muted transition-colors hover:text-text"
        >
          {COPY.pdf.openInNewTab} <ExternalLink className="size-3" />
        </a>
      </div>
    </>
  );
}

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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={name} description={COPY.pdf.subtitle(candidateId, page)} className="h-[92vh]">
        <PdfFrame key={`${candidateId}:${page}`} candidateId={candidateId} name={name} page={page} />
      </DialogContent>
    </Dialog>
  );
}
