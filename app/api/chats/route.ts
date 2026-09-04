import { listChats } from '@/lib/chats-db';

export const runtime = 'nodejs';

/** All saved conversations, most recent first. */
export async function GET() {
  try {
    return Response.json({ chats: listChats() });
  } catch (error) {
    console.error('[chats] list failed', error);
    // History is a convenience, not the product — degrade to empty rather than
    // breaking the app because the chat database is unwritable.
    return Response.json({ chats: [], error: (error as Error).message }, { status: 200 });
  }
}
