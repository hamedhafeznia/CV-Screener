import { readFile, stat } from 'node:fs/promises';
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

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!ID_PATTERN.test(id)) return new Response('Invalid candidate id.', { status: 400 });

  const directory = path.join(DATA_DIR, 'photos');
  const file = path.resolve(directory, `${id}.png`);
  if (!file.startsWith(directory + path.sep)) return new Response('Invalid candidate id.', { status: 400 });

  try {
    const [png, info] = await Promise.all([readFile(file), stat(file)]);
    // Not `immutable`: headshots are regenerable, and a day-long immutable cache
    // means a re-run of `npm run generate` appears to do nothing. An mtime/size
    // ETag keeps the request cheap while still invalidating on regeneration.
    const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }
    return new Response(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=0, must-revalidate',
        ETag: etag,
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
