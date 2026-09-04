import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '@/lib/stores';

export const runtime = 'nodejs';

/**
 * Serve a candidate headshot. Photos live in data/, not public/, because they
 * are pipeline output rather than static assets — the same reason the PDFs are
 * served through a route. Ids are pattern-checked and the resolved path
 * re-verified, as in /api/cv/[id].
 */
const ID_PATTERN = /^cv_\d{3}$/;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!ID_PATTERN.test(id)) return new Response('Invalid candidate id.', { status: 400 });

  const directory = path.join(DATA_DIR, 'photos');
  const file = path.resolve(directory, `${id}.png`);
  if (!file.startsWith(directory + path.sep)) return new Response('Invalid candidate id.', { status: 400 });

  try {
    const png = await readFile(file);
    return new Response(new Uint8Array(png), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400, immutable' },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
