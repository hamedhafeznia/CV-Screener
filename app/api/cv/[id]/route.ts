import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '@/lib/stores';

export const runtime = 'nodejs';

/**
 * Serve one CV PDF, for the citation dialog (PRD §7.5).
 *
 * The id comes from a URL, so it is untrusted: it is matched against a strict
 * pattern and the resolved path is re-checked to be inside data/cvs, which
 * closes the path-traversal hole this route would otherwise be.
 */
const ID_PATTERN = /^cv_\d{3}$/;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!ID_PATTERN.test(id)) {
    return Response.json({ error: 'Invalid candidate id.' }, { status: 400 });
  }

  const directory = path.join(DATA_DIR, 'cvs');
  const file = path.resolve(directory, `${id}.pdf`);
  if (!file.startsWith(directory + path.sep)) {
    return Response.json({ error: 'Invalid candidate id.' }, { status: 400 });
  }

  try {
    const pdf = await readFile(file);
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${id}.pdf"`,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    return Response.json({ error: `No CV found for ${id}.` }, { status: 404 });
  }
}
