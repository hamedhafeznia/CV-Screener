'use client';

import { useState } from 'react';
import type { UIMessage } from 'ai';
import { ToolTrace } from '@/components/ToolCallChip';
import { SourceGrid, SourceSkeleton } from '@/components/SourceCard';
import { PdfDialog } from '@/components/PdfDialog';
import { Thinking, derivePhase } from '@/components/Thinking';
import { citationsFromOutput, toolNameOf, type Citation, type ToolPart } from '@/components/types';

/**
 * PRD §8.4.1 — the user's turn is a right-aligned pill; the answer is full-width
 * with no bubble at all. The answer is the primary tier of the page, and a frame
 * around it would only compete with it.
 */

type OpenCitation = (id: string) => void;

/**
 * Every `cv_014` in the prose becomes a link to that candidate's actual PDF.
 *
 * The chips below the answer already list the sources, but a nineteen-name
 * answer makes you hunt for the right chip. Making the id itself the link puts
 * the document exactly where the claim about it is — which is the whole point of
 * citing inline (PRD §7.4).
 */
function withInlineIds(text: string, known: Map<string, Citation>, onOpen: OpenCitation) {
  return text.split(/(\bcv_\d{3}\b)/g).map((piece, i) => {
    if (!/^cv_\d{3}$/.test(piece)) return <span key={i}>{piece}</span>;

    const citation = known.get(piece);
    // An id the tools never returned is not a link — it would 404, and the
    // system prompt forbids citing one, so surfacing it plainly is honest.
    if (!citation) {
      return (
        <span key={i} className="font-mono text-[0.85em] text-faint">
          {piece}
        </span>
      );
    }
    return (
      <button
        key={i}
        type="button"
        onClick={() => onOpen(piece)}
        title={`Open ${citation.name}'s CV${citation.page > 1 ? `, page ${citation.page}` : ''}`}
        className="rounded-[3px] font-mono text-[0.85em] text-muted underline decoration-dotted decoration-from-font underline-offset-[3px] transition-colors hover:bg-surface hover:text-text focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-faint"
      >
        {piece}
      </button>
    );
  });
}

/** Strip the markdown emphasis the model sometimes adds, and bold what it wrapped. */
function withEmphasis(text: string, known: Map<string, Citation>, onOpen: OpenCitation) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((piece, i) =>
    piece.startsWith('**') && piece.endsWith('**') ? (
      <strong key={i}>{withInlineIds(piece.slice(2, -2), known, onOpen)}</strong>
    ) : (
      <span key={i}>{withInlineIds(piece, known, onOpen)}</span>
    ),
  );
}

/**
 * Deliberately not a markdown renderer. The system prompt asks for short lists
 * and plain sentences, so paragraphs, bullets and bold are all this needs — and
 * a dependency-free version cannot render anything the model did not intend.
 */
function AnswerText({
  text,
  caret,
  known,
  onOpen,
}: {
  text: string;
  caret?: boolean;
  known: Map<string, Citation>;
  onOpen: OpenCitation;
}) {
  const blocks = text.split(/\n{2,}/);
  const lastBlock = blocks.length - 1;
  return (
    <div className="answer text-base leading-[1.7] text-text">
      {blocks.map((block, blockIndex) => {
        const lines = block.split('\n').filter((line) => line.trim());
        const bulleted = lines.length > 0 && lines.every((line) => /^\s*([-*•]|\d+[.)])\s+/.test(line));
        const trailing = caret && blockIndex === lastBlock;
        if (bulleted) {
          return (
            <ul key={blockIndex}>
              {lines.map((line, i) => (
                <li key={i} className={trailing && i === lines.length - 1 ? 'caret' : undefined}>
                  {withEmphasis(line.replace(/^\s*([-*•]|\d+[.)])\s+/, ''), known, onOpen)}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={blockIndex} className={trailing ? 'caret' : undefined}>
            {withEmphasis(block, known, onOpen)}
          </p>
        );
      })}
    </div>
  );
}

export function Message({
  message,
  seconds,
  streaming,
}: {
  message: UIMessage;
  seconds?: number;
  streaming: boolean;
}) {
  const [open, setOpen] = useState<Citation | null>(null);

  if (message.role === 'user') {
    const text = message.parts
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('');
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] whitespace-pre-wrap rounded-[var(--radius-lg)] bg-surface px-4 py-2.5 text-base leading-6 text-text">
          {text}
        </div>
      </div>
    );
  }

  // Tool activity collapses into one trace above the answer; citations are
  // gathered from every tool result and used for both the inline links and the
  // chips below.
  const tools: { toolName: string; part: ToolPart }[] = [];
  const citations: Citation[] = [];
  const known = new Map<string, Citation>();
  const seen = new Set<string>();
  const text: string[] = [];

  for (const part of message.parts) {
    if (part.type === 'text') {
      if (part.text.trim()) text.push(part.text);
      continue;
    }
    const toolName = toolNameOf(part);
    if (!toolName) continue;

    const toolPart = part as unknown as ToolPart;
    tools.push({ toolName, part: toolPart });
    if (toolPart.state === 'output-available') {
      for (const citation of citationsFromOutput(toolPart.output)) {
        const key = `${citation.candidate_id}:${citation.page}`;
        if (!seen.has(key)) {
          seen.add(key);
          citations.push(citation);
        }
        // First page wins as the inline link target, so a repeated name always
        // opens the same place.
        if (!known.has(citation.candidate_id)) known.set(citation.candidate_id, citation);
      }
    }
  }

  const phase = streaming ? derivePhase(message) : null;
  const retrieving = streaming && tools.length > 0 && citations.length === 0;

  return (
    <div className="space-y-4">
      <ToolTrace tools={tools} steps={tools.length + 1} seconds={seconds} streaming={streaming} />

      {text.map((block, i) => (
        <AnswerText
          key={i}
          text={block}
          caret={streaming && i === text.length - 1}
          known={known}
          onOpen={(id) => setOpen(known.get(id) ?? null)}
        />
      ))}

      {phase ? <Thinking label={phase} /> : null}

      {/* Sources hold a skeleton row while retrieval is still running, so the
          answer does not jump when the real chips arrive. */}
      {retrieving ? <SourceSkeleton /> : <SourceGrid citations={citations} />}

      {open ? (
        <PdfDialog
          candidateId={open.candidate_id}
          name={open.name}
          page={open.page}
          open
          onOpenChange={(value) => !value && setOpen(null)}
        />
      ) : null}
    </div>
  );
}
