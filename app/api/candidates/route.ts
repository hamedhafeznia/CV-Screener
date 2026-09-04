import { getRoster } from '@/lib/tools';
import { IndexNotBuiltError } from '@/lib/stores';

export const runtime = 'nodejs';

/** Roster for the sidebar (PRD §7.5). */
export async function GET() {
  try {
    const candidates = getRoster();
    return Response.json({ total: candidates.length, candidates });
  } catch (error) {
    if (error instanceof IndexNotBuiltError) {
      return Response.json({ error: error.message, total: 0, candidates: [] }, { status: 503 });
    }
    throw error;
  }
}
