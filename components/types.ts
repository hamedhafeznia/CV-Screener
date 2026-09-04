/** Shapes the chat UI reads out of streamed tool parts. */

export interface Candidate {
  id: string;
  name: string;
  current_title: string;
  location: string;
  photo_path: string;
  years_experience: number;
}

export interface Citation {
  candidate_id: string;
  name: string;
  current_title: string;
  page: number;
  /** Section or snippet that produced the citation, when there is one. */
  detail?: string;
}

/** A tool part as the AI SDK streams it, narrowed to what the chips render. */
export interface ToolPart {
  type: string;
  toolCallId?: string;
  state?: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

export const TOOL_LABELS: Record<string, string> = {
  search_cvs: 'search_cvs',
  filter_candidates: 'filter_candidates',
  get_cv: 'get_cv',
};

export function toolNameOf(part: { type: string }): string | null {
  return part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : null;
}

/** "skill=python · min_years=6" — the chip's one-line argument summary. */
export function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  return Object.entries(input as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' · ');
}

/** "18 matches" — the chip's one-line result summary. */
export function summarizeOutput(toolName: string, output: unknown): string {
  if (!output || typeof output !== 'object') return '';
  const record = output as Record<string, unknown>;
  if ('error' in record) return String(record.error);
  if (toolName === 'filter_candidates') {
    const total = Number(record.total ?? 0);
    return `${total} ${total === 1 ? 'match' : 'matches'}`;
  }
  if (toolName === 'search_cvs') {
    const total = Number(record.total ?? 0);
    return `${total} ${total === 1 ? 'passage' : 'passages'}`;
  }
  if (toolName === 'get_cv') {
    const candidate = record.candidate as { name?: string } | undefined;
    return candidate?.name ? `full CV · ${candidate.name}` : 'full CV';
  }
  return '';
}

/**
 * Collect citations out of a tool result, whatever its shape.
 *
 * Every tool returns candidate_id / name / current_title / page on each result
 * precisely so this stays a dumb walk rather than three bespoke readers.
 */
export function citationsFromOutput(output: unknown): Citation[] {
  const found = new Map<string, Citation>();

  const consider = (node: Record<string, unknown>, detail?: string) => {
    const id = node.candidate_id;
    const name = node.name;
    if (typeof id !== 'string' || typeof name !== 'string') return;
    const page = Number(node.page ?? 1) || 1;
    const key = `${id}:${page}`;
    if (!found.has(key)) {
      found.set(key, {
        candidate_id: id,
        name,
        current_title: typeof node.current_title === 'string' ? node.current_title : '',
        page,
        detail,
      });
    }
  };

  const walk = (node: unknown, detail?: string) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach((item) => walk(item, detail));
    if (typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    consider(record, typeof record.section === 'string' ? record.section : detail);
    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') walk(value, detail);
    }
  };

  walk(output);
  return [...found.values()];
}
