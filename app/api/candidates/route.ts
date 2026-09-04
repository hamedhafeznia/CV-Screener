import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getRoster } from '@/lib/tools';
import { DATA_DIR, IndexNotBuiltError } from '@/lib/stores';
import { currentModel } from '@/lib/llm';

export const runtime = 'nodejs';

/** Roster for the sidebar, plus the index metadata the composer footer shows. */
export async function GET() {
  try {
    const candidates = getRoster();
    let chunks: number | null = null;
    try {
      const manifest = JSON.parse(readFileSync(path.join(DATA_DIR, 'index-manifest.json'), 'utf8'));
      chunks = manifest.chunks ?? null;
    } catch {
      // Manifest is written by ingest; its absence is not an error.
    }
    return Response.json({
      total: candidates.length,
      candidates,
      meta: { model: currentModel(), chunks },
    });
  } catch (error) {
    if (error instanceof IndexNotBuiltError) {
      return Response.json({ error: error.message, total: 0, candidates: [] }, { status: 503 });
    }
    throw error;
  }
}
