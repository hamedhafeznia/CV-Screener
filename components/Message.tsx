'use client';

import type { UIMessage } from 'ai';
import { ToolCallChip } from '@/components/ToolCallChip';
import { SourceGrid } from '@/components/SourceCard';
import { citationsFromOutput, toolNameOf, type Citation, type ToolPart } from '@/components/types';

/**
 * PRD §8.4.1 — user messages are right-aligned and capped; assistant answers are
 * full-width with no bubble. The answer is the primary tier of the page, and a
 * chat bubble is a frame around it that earns nothing.
 */

/** Render `cv_014` and the ids inside `(cv_014)` in mono so citations read as data. */
function withInlineIds(text: string) {
  return text.split(/(\bcv_\d{3}\b)/g).map((piece, i) =>
    /^cv_\d{3}$/.test(piece) ? (
      <span key={i} className="font-mono text-[0.85em] text-accent">
        {piece}
      </span>
    ) : (
      <span key={i}>{piece}</span>
    ),
  );
}

/**
 * Deliberately not a markdown renderer. The system prompt asks for short lists
 * and plain sentences, so paragraph and bullet handling is all this needs — and
 * a dependency-free version cannot render anything the model did not intend.
 */
function AnswerText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="answer text-base leading-7 text-text">
      {blocks.map((block, blockIndex) => {
        const lines = block.split('\n').filter((line) => line.trim());
        const bulleted = lines.length > 0 && lines.every((line) => /^\s*([-*•]|\d+[.)])\s+/.test(line));
        if (bulleted) {
          return (
            <ul key={blockIndex}>
              {lines.map((line, i) => (
                <li key={i}>{withInlineIds(line.replace(/^\s*([-*•]|\d+[.)])\s+/, ''))}</li>
              ))}
            </ul>
          );
        }
        return <p key={blockIndex}>{withInlineIds(block)}</p>;
      })}
    </div>
  );
}

export function Message({ message }: { message: UIMessage }) {
  if (message.role === 'user') {
    const text = message.parts
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('');
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-[var(--radius)] bg-surface-2 px-3.5 py-2 text-base leading-6 text-text">
          {text}
        </div>
      </div>
    );
  }

  const citations: Citation[] = [];
  const seen = new Set<string>();

  const rendered = message.parts.map((part, index) => {
    if (part.type === 'text') {
      return part.text.trim() ? <AnswerText key={index} text={part.text} /> : null;
    }

    const toolName = toolNameOf(part);
    if (!toolName) return null;

    const toolPart = part as unknown as ToolPart;
    if (toolPart.state === 'output-available') {
      for (const citation of citationsFromOutput(toolPart.output)) {
        const key = `${citation.candidate_id}:${citation.page}`;
        if (!seen.has(key)) {
          seen.add(key);
          citations.push(citation);
        }
      }
    }
    return <ToolCallChip key={toolPart.toolCallId ?? index} toolName={toolName} part={toolPart} />;
  });

  return (
    <div className="space-y-2">
      {rendered}
      <SourceGrid citations={citations} />
    </div>
  );
}
