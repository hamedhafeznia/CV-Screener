'use client';

import type { UIMessage } from 'ai';
import { summarizeInput, toolNameOf, type ToolPart } from '@/components/types';

/**
 * What the model is doing right now, in words.
 *
 * A generic spinner would be a wasted signal here. The agentic loop has real
 * phases — embed, filter, fetch a document, write — and the gap before the first
 * token is dominated by retrieval, so naming the phase is both better feedback
 * and a continuation of the PRD's §8.1 goal of making the retrieval visible.
 * Every label below is derived from the actual stream, never faked on a timer.
 */

const TOOL_LABELS: Record<string, string> = {
  search_cvs: 'Searching CVs',
  filter_candidates: 'Filtering candidates',
  get_cv: 'Reading the full CV',
};

/** Null once the answer starts arriving — the text itself becomes the feedback. */
export function derivePhase(message: UIMessage | null): string | null {
  if (!message) return 'Thinking';

  const parts = message.parts ?? [];
  const hasText = parts.some((part) => part.type === 'text' && part.text.trim().length > 0);
  if (hasText) return null;

  const tools = parts
    .map((part) => ({ name: toolNameOf(part), part: part as unknown as ToolPart }))
    .filter((entry): entry is { name: string; part: ToolPart } => entry.name !== null);

  const last = tools.at(-1);
  if (!last) return 'Thinking';

  const label = TOOL_LABELS[last.name] ?? last.name;
  if (last.part.state === 'input-streaming') return label;
  if (last.part.state === 'input-available') {
    const args = summarizeInput(last.part.input);
    return args ? `${label} · ${args}` : label;
  }
  // Results are in but no prose yet: the model is composing the answer.
  return 'Writing the answer';
}

export function Thinking({ label }: { label: string }) {
  return (
    <div className="rise space-y-3" aria-live="polite">
      <p className="text-sm">
        <span className="shimmer">{label}…</span>
      </p>
      {/* Three lines roughly the shape of the answer that is coming, so the
          column does not jump when text replaces this. */}
      <div className="space-y-2" aria-hidden>
        <div className="skeleton h-3 w-[85%]" />
        <div className="skeleton h-3 w-[70%]" />
        <div className="skeleton h-3 w-[45%]" />
      </div>
    </div>
  );
}
