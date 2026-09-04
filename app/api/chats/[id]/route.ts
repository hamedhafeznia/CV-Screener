import {
  CHAT_ID_PATTERN,
  ChatTooLargeError,
  ChatUpsertSchema,
  deleteChat,
  getChat,
  upsertChat,
} from '@/lib/chats-db';

export const runtime = 'nodejs';

/**
 * One conversation. The id comes from the URL and the body from the client, so
 * both are validated: the id against a strict pattern (it reaches a SQL
 * parameter and nothing else), the body against a Zod schema that bounds the
 * title length and the message count.
 */
function badId() {
  return Response.json({ error: 'Invalid chat id.' }, { status: 400 });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!CHAT_ID_PATTERN.test(id)) return badId();

  const chat = getChat(id);
  if (!chat) return Response.json({ error: 'Not found.' }, { status: 404 });
  return Response.json({ chat });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!CHAT_ID_PATTERN.test(id)) return badId();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = ChatUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Invalid chat payload.', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    return Response.json({ chat: upsertChat(id, parsed.data) });
  } catch (error) {
    if (error instanceof ChatTooLargeError) {
      return Response.json({ error: error.message }, { status: 413 });
    }
    console.error('[chats] upsert failed', error);
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!CHAT_ID_PATTERN.test(id)) return badId();
  return Response.json({ deleted: deleteChat(id) });
}
