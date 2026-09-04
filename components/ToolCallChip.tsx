'use client';

import { useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { COPY } from '@/lib/copy';
import { summarizeInput, summarizeOutput, type ToolPart } from '@/components/types';

/**
 * Tertiary tier (PRD §8.3): quiet, collapsed, but never hidden.
 *
 * All of a turn's tool activity collapses into one row — how many calls, how
 * many steps, how long — and expands to the individual calls with their
 * arguments and results. Present enough to prove the answer came from real
 * retrieval and to show which retriever the model chose; small enough that it
 * never competes with the answer above it.
 */

function StepDots({ done, total }: { done: number; total: number }) {
  return (
    <span className="flex items-center gap-[3px]" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn('size-1 rounded-full transition-colors', i < done ? 'bg-muted' : 'bg-surface-2')}
        />
      ))}
    </span>
  );
}

function ToolRow({ toolName, part }: { toolName: string; part: ToolPart }) {
  const [open, setOpen] = useState(false);
  const pending = part.state === 'input-streaming' || part.state === 'input-available';
  const failed = part.state === 'output-error';
  const args = summarizeInput(part.input);
  const result = failed ? (part.errorText ?? COPY.trace.failed) : summarizeOutput(toolName, part.output);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-[var(--radius)] px-2 py-1.5 text-left',
          'font-mono text-xs transition-colors hover:bg-surface-2',
          failed ? 'text-danger' : 'text-faint',
        )}
      >
        <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
        {pending ? <Loader2 className="size-3 shrink-0 animate-spin" /> : null}
        <span className="truncate">
          <span className="text-muted">{toolName}</span>
          {args ? <span> · {args}</span> : null}
          {result ? <span className="text-muted"> → {result}</span> : null}
        </span>
      </button>

      {open ? (
        <pre className="mx-2 mb-1 max-h-64 overflow-auto rounded-[var(--radius)] bg-page/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-faint scrollbar-slim">
          {JSON.stringify({ input: part.input, output: part.output ?? part.errorText }, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

export function ToolTrace({
  tools,
  steps,
  seconds,
  streaming,
}: {
  tools: { toolName: string; part: ToolPart }[];
  steps: number;
  seconds?: number;
  streaming: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (tools.length === 0) return null;

  const done = tools.filter((t) => t.part.state === 'output-available' || t.part.state === 'output-error').length;
  const running = streaming && done < tools.length;

  return (
    <div className="rounded-[var(--radius)] bg-surface">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-xs text-faint transition-colors hover:text-muted"
      >
        {running ? <Loader2 className="size-3 shrink-0 animate-spin" /> : null}
        <span className={cn('tabular-nums', running && 'shimmer')}>{COPY.trace.tools(tools.length)}</span>
        <span className="text-surface-2">|</span>
        <span className="flex items-center gap-2 tabular-nums">
          {COPY.trace.progress(done, tools.length)}
          <StepDots done={done} total={tools.length} />
        </span>
        {/* Elapsed is in-memory only, so a chat restored from storage has none.
            Drop the segment rather than showing a placeholder for it. */}
        {streaming || seconds !== undefined ? (
          <>
            <span className="text-surface-2">|</span>
            <span className="tabular-nums">
              {streaming ? COPY.trace.steps(steps) : COPY.trace.seconds(seconds!)}
            </span>
          </>
        ) : null}
        <ChevronRight className={cn('ml-auto size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
      </button>

      {open ? (
        <div className="pb-1.5">
          {tools.map(({ toolName, part }, i) => (
            <ToolRow key={part.toolCallId ?? i} toolName={toolName} part={part} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
