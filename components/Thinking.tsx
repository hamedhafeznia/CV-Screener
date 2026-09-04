'use client';

import type { UIMessage } from 'ai';
import { Database, Sparkles } from 'lucide-react';
import { summarizeInput, toolNameOf, type ToolPart } from '@/components/types';

/**
 * What the system is doing right now, in words.
 *
 * A generic spinner would waste a real signal. A turn alternates between two
 * very different waits, and they take very different amounts of time:
 *
 *   model  — a round trip to Gemini, seconds, and the reason the turn feels slow
 *   local  — SQLite or LanceDB on disk, milliseconds
 *
 * Saying which one you are waiting on is more honest than "loading", and it
 * continues the PRD §8.1 goal of making the retrieval legible. Every label is
 * derived from the live stream; nothing is faked on a timer.
 */

/** Where the current wait actually is. */
export type PhaseSource = 'model' | 'local';

export interface Phase {
  label: string;
  source: PhaseSource;
}

const TOOL_PHASES: Record<string, { label: string; source: PhaseSource }> = {
  // Pure SQL over the committed index — no API call at all.
  filter_candidates: { label: 'Filtering candidates', source: 'local' },
  get_cv: { label: 'Reading the full CV', source: 'local' },
  // The only tool that costs a model call: the query has to be embedded with the
  // same model the index was built with.
  search_cvs: { label: 'Embedding the query and searching chunks', source: 'model' },
};

/** Null once the answer starts arriving — the text itself becomes the feedback. */
export function derivePhase(message: UIMessage | null, model?: string): Phase | null {
  const name = model ?? 'the model';

  if (!message) return { label: `Asking ${name}`, source: 'model' };

  const parts = message.parts ?? [];
  const hasText = parts.some((part) => part.type === 'text' && part.text.trim().length > 0);
  if (hasText) return null;

  const tools = parts
    .map((part) => ({ name: toolNameOf(part), part: part as unknown as ToolPart }))
    .filter((entry): entry is { name: string; part: ToolPart } => entry.name !== null);

  const last = tools.at(-1);
  // Nothing back yet: the model is deciding which retriever to use.
  if (!last) return { label: `Asking ${name}`, source: 'model' };

  const phase = TOOL_PHASES[last.name] ?? { label: last.name, source: 'local' as const };

  if (last.part.state === 'input-streaming') return phase;
  if (last.part.state === 'input-available') {
    const args = summarizeInput(last.part.input);
    return { ...phase, label: args ? `${phase.label} · ${args}` : phase.label };
  }

  // Results are in; the slow part now is the model composing prose from them.
  return { label: `Waiting for ${name} to write the answer`, source: 'model' };
}

export function Thinking({ phase }: { phase: Phase }) {
  const Icon = phase.source === 'model' ? Sparkles : Database;

  return (
    <div className="rise space-y-3" aria-live="polite">
      <p className="flex items-center gap-2 text-sm">
        <Icon className={phase.source === 'model' ? 'size-3.5 shrink-0 text-muted' : 'size-3.5 shrink-0 text-faint'} />
        <span className="shimmer">{phase.label}…</span>
        <span className="font-mono text-xs text-faint">
          {phase.source === 'model' ? 'api' : 'local index'}
        </span>
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
