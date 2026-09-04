'use client';

import { useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { summarizeInput, summarizeOutput, type ToolPart } from '@/components/types';

/**
 * Tertiary tier (PRD §8.3): 12px mono, muted, collapsed by default.
 *
 * Quiet but present is exactly the point. The chip is what proves the answer
 * came from a real retrieval call — and which one the model chose — without
 * competing with the answer for attention.
 */
export function ToolCallChip({ toolName, part }: { toolName: string; part: ToolPart }) {
  const [expanded, setExpanded] = useState(false);

  const pending = part.state === 'input-streaming' || part.state === 'input-available';
  const failed = part.state === 'output-error';
  const args = summarizeInput(part.input);
  const result = failed ? (part.errorText ?? 'failed') : summarizeOutput(toolName, part.output);

  return (
    <div className="font-mono text-xs">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-[var(--radius)] px-1.5 py-1 text-left transition-colors hover:bg-surface-2',
          failed ? 'text-danger' : 'text-muted',
        )}
      >
        <ChevronRight className={cn('size-3 shrink-0 transition-transform', expanded && 'rotate-90')} />
        {pending ? <Loader2 className="size-3 shrink-0 animate-spin" /> : <span className="shrink-0">⌗</span>}
        <span className="truncate">
          <span className="text-text/70">{toolName}</span>
          {args ? <span> · {args}</span> : null}
          {result ? <span className="text-text/70"> → {result}</span> : null}
        </span>
      </button>

      {expanded ? (
        <pre className="mt-1 max-h-64 overflow-auto rounded-[var(--radius)] border border-border bg-surface px-2.5 py-2 text-[11px] leading-relaxed text-muted scrollbar-slim">
          {JSON.stringify({ input: part.input, output: part.output ?? part.errorText }, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
