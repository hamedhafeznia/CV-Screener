import { convertToModelMessages, type UIMessage } from 'ai';
import { streamAnswer } from '@/lib/agent';
import { IndexNotBuiltError } from '@/lib/stores';
import type { ChatMode } from '@/lib/schemas';

export const runtime = 'nodejs';
export const maxDuration = 60;

function lastUserText(messages: UIMessage[]): string {
  const message = [...messages].reverse().find((m) => m.role === 'user');
  if (!message) return '';
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join(' ')
    .trim();
}

/** POST { messages, mode?: 'agentic' | 'classic' }. Stateless — the client holds history. */
export async function POST(request: Request) {
  let body: { messages?: UIMessage[]; mode?: ChatMode };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const messages = body.messages ?? [];
  const mode: ChatMode = body.mode === 'classic' ? 'classic' : 'agentic';
  if (messages.length === 0) {
    return Response.json({ error: 'No messages supplied.' }, { status: 400 });
  }

  try {
    const result = await streamAnswer(convertToModelMessages(messages), mode, lastUserText(messages));
    // Tool calls and results are streamed to the client rather than hidden:
    // making the retrieval visible is the point of the interface (PRD §8.1).
    return result.toUIMessageStreamResponse({ sendReasoning: false });
  } catch (error) {
    if (error instanceof IndexNotBuiltError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    console.error('[chat]', error);
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
