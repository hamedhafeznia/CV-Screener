'use client';

import type { UIMessage } from 'ai';
import { ToolTrace } from '@/components/ToolCallChip';
import { SourceGrid } from '@/components/SourceCard';
import { Thinking, derivePhase } from '@/components/Thinking';
import { citationsFromOutput, toolNameOf, type Citation, type ToolPart } from '@/components/types';

/**
 * PRD §8.4.1 — the user's turn is a right-aligned pill; the answer is full-width
 * with no bubble at all. The answer is the primary tier of the page, and a frame
 * around it would only compete with it.
 */

/** Render `cv_014` in mono so citations read as data rather than prose. */
function withInlineIds(text: string) {
  return text.split(/(\bcv_\d{3}\b)/g).map((piece, i) =>
    /^cv_\d{3}$/.test(piece) ? (
      <span key={i} className="font-mono text-[0.85em] text-muted">
        {piece}
      </span>
    ) : (
      <span key={i}>{piece}</span>
    ),
  );
}

/** Strip the markdown emphasis the model sometimes adds, and bold what it wrapped. */
function withEmphasis(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((piece, i) =>
    piece.startsWith('**') && piece.endsWith('**') ? (
      <strong key={i}>{withInlineIds(piece.slice(2, -2))}</strong>
    ) : (
      <span key={i}>{withInlineIds(piece)}</span>
    ),
  );
}

/**
 * Deliberately not a markdown renderer. The system prompt asks for short lists
 * and plain sentences, so paragraphs, bullets and bold are all this needs — and
 * a dependency-free version cannot render anything the model did not intend.
 */
function AnswerText({ text, caret }: { text: string; caret?: boolean }) {
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
                  {withEmphasis(line.replace(/^\s*([-*•]|\d+[.)])\s+/, ''))}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={blockIndex} className={trailing ? 'caret' : undefined}>
            {withEmphasis(block)}
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
  // gathered from every tool result and rendered as chips below it.
  const tools: { toolName: string; part: ToolPart }[] = [];
  const citations: Citation[] = [];
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
      }
    }
  }

  const phase = streaming ? derivePhase(message) : null;

  return (
    <div className="space-y-4">
      <ToolTrace tools={tools} steps={tools.length + 1} seconds={seconds} streaming={streaming} />
      {text.map((block, i) => (
        <AnswerText key={i} text={block} caret={streaming && i === text.length - 1} />
      ))}
      {phase ? <Thinking label={phase} /> : null}
      {/* Sources settle in once retrieval is done rather than shuffling as
          each tool result lands. */}
      {streaming ? null : <SourceGrid citations={citations} />}
    </div>
  );
}
