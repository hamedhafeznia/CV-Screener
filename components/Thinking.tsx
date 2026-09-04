'use client';

import type { UIMessage } from 'ai';
import { Database, Sparkles } from 'lucide-react';
import { COPY } from '@/lib/copy';
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

/**
 * Where each tool's wait actually happens. `filter_candidates` and `get_cv` are
 * pure SQL over the committed index; `search_cvs` is the only one that costs a
 * model call, because the query must be embedded with the same model the index
 * was built with. Labels live in lib/copy.ts.
 */
const TOOL_SOURCE: Record<string, PhaseSource> = {
  filter_candidates: 'local',
  get_cv: 'local',
  search_cvs: 'model',
};

/** Null once the answer starts arriving — the text itself becomes the feedback. */
export function derivePhase(message: UIMessage | null, model?: string): Phase | null {
  const name = model ?? COPY.thinking.unknownModel;

  if (!message) return { label: COPY.thinking.asking(name), source: 'model' };

  const parts = message.parts ?? [];
  const hasText = parts.some((part) => part.type === 'text' && part.text.trim().length > 0);
  if (hasText) return null;

  const tools = parts
    .map((part) => ({ name: toolNameOf(part), part: part as unknown as ToolPart }))
    .filter((entry): entry is { name: string; part: ToolPart } => entry.name !== null);

  const last = tools.at(-1);
  // Nothing back yet: the model is deciding which retriever to use.
  if (!last) return { label: COPY.thinking.asking(name), source: 'model' };

  const phase: Phase = {
    label: COPY.thinking.tools[last.name] ?? last.name,
    source: TOOL_SOURCE[last.name] ?? 'local',
  };

  if (last.part.state === 'input-streaming') return phase;
  if (last.part.state === 'input-available') {
    const args = summarizeInput(last.part.input);
    return { ...phase, label: args ? `${phase.label} · ${args}` : phase.label };
  }

  // Results are in; the slow part now is the model composing prose from them.
  return { label: COPY.thinking.writing(name), source: 'model' };
}

export function Thinking({ phase }: { phase: Phase }) {
  const Icon = phase.source === 'model' ? Sparkles : Database;

  return (
    <div className="rise space-y-3" aria-live="polite">
      <p className="flex items-center gap-2 text-sm">
        <Icon className={phase.source === 'model' ? 'size-3.5 shrink-0 text-muted' : 'size-3.5 shrink-0 text-faint'} />
        <span className="shimmer">{phase.label}…</span>
        <span className="font-mono text-xs text-faint">
          {phase.source === 'model' ? COPY.thinking.source.model : COPY.thinking.source.local}
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
