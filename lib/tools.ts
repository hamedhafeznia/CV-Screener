import { tool } from 'ai';
import { z } from 'zod';
import { normalizeInstitution, normalizeSkill } from './aliases';
import { embedQuery } from './llm';
import { getChunkTable, getDb } from './stores';
import type { CandidateRow, ChunkHit, CitationRef } from './schemas';

/**
 * The three retrievers (PRD §7.2).
 *
 * Classic single-shot RAG — embed, take top-k, stuff the prompt — cannot answer
 * two of the three questions this project is graded on:
 *
 *   "Who has experience with Python?"  top-k structurally caps recall at k.
 *                                      The right answer is a set, not a ranking.
 *   "Which candidate graduated from UPC?"  an acronym and its expansion are not
 *                                      near each other in embedding space, and
 *                                      thirty CVs of European engineers are all
 *                                      near each other.
 *
 * So the model routes between three retrievers instead of always calling one.
 * Vector search stays the primary path for genuinely fuzzy questions; classic
 * RAG is the degenerate case of this design with the other two tools removed.
 *
 * Every tool is a plain exported function, callable and testable without an LLM
 * anywhere in the loop. The `*Tool` wrappers exist only to hand them to the model.
 *
 * SECURITY: tool arguments are model-generated, i.e. untrusted input reaching
 * SQL. Every value below goes through a `?` placeholder — there is no string
 * interpolation into a query, and deliberately no `run_sql` tool.
 */

const MAX_TOP_K = 25;

function citation(row: {
  id: string;
  name: string;
  current_title: string;
  pdf_path: string;
}, page: number): CitationRef {
  return {
    candidate_id: row.id,
    name: row.name,
    current_title: row.current_title,
    pdf_path: row.pdf_path,
    page,
  };
}

/* ------------------------------------------------------------ search_cvs --- */

export interface SearchResult {
  query: string;
  total: number;
  hits: ChunkHit[];
}

/** Semantic search over chunk vectors. For conceptual, fuzzy questions. */
export async function searchCvs({ query, top_k = 8 }: { query: string; top_k?: number }): Promise<SearchResult> {
  const limit = Math.min(Math.max(1, top_k), MAX_TOP_K);
  const vector = await embedQuery(query);
  const table = await getChunkTable();
  const rows = (await table.vectorSearch(vector).limit(limit).toArray()) as Record<string, unknown>[];

  const db = getDb();
  const lookup = db.prepare('SELECT id, name, current_title, pdf_path FROM candidates WHERE id = ?');

  const hits: ChunkHit[] = rows.map((row) => {
    const candidateId = String(row.candidate_id);
    const candidate = lookup.get(candidateId) as
      | { id: string; name: string; current_title: string; pdf_path: string }
      | undefined;
    const page = Number(row.page ?? 1);
    return {
      ...citation(
        candidate ?? {
          id: candidateId,
          name: String(row.candidate_name ?? candidateId),
          current_title: '',
          pdf_path: `data/cvs/${candidateId}.pdf`,
        },
        page,
      ),
      chunk_id: String(row.chunk_id),
      section: String(row.section),
      text: String(row.text),
      // LanceDB returns L2 distance; report similarity so bigger is better.
      score: Number.isFinite(Number(row._distance)) ? 1 / (1 + Number(row._distance)) : 0,
    };
  });

  return { query, total: hits.length, hits };
}

/* ---------------------------------------------------- filter_candidates --- */

export const FilterInputSchema = z.object({
  skill: z.string().optional().describe('A skill, tool or language, e.g. "Python", "k8s", "Postgres"'),
  institution: z.string().optional().describe('A university, full name or acronym, e.g. "UPC"'),
  min_years: z.number().optional().describe('Minimum years of experience, inclusive'),
  max_years: z.number().optional().describe('Maximum years of experience, inclusive'),
  language: z.string().optional().describe('A spoken language, e.g. "Spanish"'),
  title_contains: z.string().optional().describe('Substring of the current job title, e.g. "Engineer"'),
  location: z.string().optional().describe('City or country substring, e.g. "Barcelona"'),
  seniority: z.enum(['junior', 'mid', 'senior', 'lead', 'principal']).optional(),
  company: z.string().optional().describe('An employer named anywhere in the work history'),
});

export type FilterInput = z.infer<typeof FilterInputSchema>;

export interface FilterMatch extends CitationRef {
  location: string;
  seniority: string;
  years_experience: number;
  /** Why this candidate matched — the raw values behind the normalized filter. */
  matched: Record<string, string>;
}

export interface FilterResult {
  filters: FilterInput;
  total: number;
  /** True when every match is returned, which for this tool is always. */
  complete: boolean;
  candidates: FilterMatch[];
}

/**
 * Parameterized SQL over the structured store. Returns EVERY match plus a count
 * — never a top-k slice. That property is the whole reason this tool exists:
 * "who has experience with Python?" is a set-membership question, and a ranked
 * subset is a wrong answer to it however well ranked it is.
 */
export function filterCandidates(input: FilterInput): FilterResult {
  const filters = FilterInputSchema.parse(input);
  const db = getDb();

  const where: string[] = [];
  const params: (string | number)[] = [];

  if (filters.skill) {
    where.push('EXISTS (SELECT 1 FROM skills s WHERE s.candidate_id = c.id AND s.skill_norm = ?)');
    params.push(normalizeSkill(filters.skill));
  }
  if (filters.institution) {
    where.push('EXISTS (SELECT 1 FROM education e WHERE e.candidate_id = c.id AND e.institution_norm = ?)');
    params.push(normalizeInstitution(filters.institution));
  }
  if (filters.language) {
    where.push('EXISTS (SELECT 1 FROM languages l WHERE l.candidate_id = c.id AND lower(l.language) = ?)');
    params.push(filters.language.trim().toLowerCase());
  }
  if (filters.company) {
    where.push('EXISTS (SELECT 1 FROM experience x WHERE x.candidate_id = c.id AND lower(x.company) LIKE ?)');
    params.push(`%${filters.company.trim().toLowerCase()}%`);
  }
  if (filters.min_years !== undefined) {
    where.push('c.years_experience >= ?');
    params.push(filters.min_years);
  }
  if (filters.max_years !== undefined) {
    where.push('c.years_experience <= ?');
    params.push(filters.max_years);
  }
  if (filters.title_contains) {
    where.push('lower(c.current_title) LIKE ?');
    params.push(`%${filters.title_contains.trim().toLowerCase()}%`);
  }
  if (filters.location) {
    where.push('lower(c.location) LIKE ?');
    params.push(`%${filters.location.trim().toLowerCase()}%`);
  }
  if (filters.seniority) {
    where.push('c.seniority = ?');
    params.push(filters.seniority);
  }

  const sql =
    'SELECT c.id, c.name, c.current_title, c.location, c.seniority, c.years_experience, c.pdf_path ' +
    'FROM candidates c' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY c.years_experience DESC, c.name';

  const rows = db.prepare(sql).all(...params) as unknown as CandidateRow[];

  // Report the raw surface form that matched, so the answer can quote the CV
  // rather than the normalized key.
  const skillMatch = db.prepare('SELECT skill FROM skills WHERE candidate_id = ? AND skill_norm = ? LIMIT 1');
  const eduMatch = db.prepare('SELECT institution, degree, field, end_year FROM education WHERE candidate_id = ? AND institution_norm = ? LIMIT 1');
  const companyMatch = db.prepare('SELECT company, title FROM experience WHERE candidate_id = ? AND lower(company) LIKE ? LIMIT 1');

  const candidates: FilterMatch[] = rows.map((row) => {
    const matched: Record<string, string> = {};
    if (filters.skill) {
      const hit = skillMatch.get(row.id, normalizeSkill(filters.skill)) as { skill: string } | undefined;
      if (hit) matched.skill = hit.skill;
    }
    if (filters.institution) {
      const hit = eduMatch.get(row.id, normalizeInstitution(filters.institution)) as
        | { institution: string; degree: string; field: string; end_year: number }
        | undefined;
      if (hit) matched.institution = `${hit.degree} ${hit.field}, ${hit.institution} (${hit.end_year})`.trim();
    }
    if (filters.company) {
      const hit = companyMatch.get(row.id, `%${filters.company.trim().toLowerCase()}%`) as
        | { company: string; title: string }
        | undefined;
      if (hit) matched.company = `${hit.title}, ${hit.company}`;
    }
    return {
      ...citation(row, 1),
      location: row.location,
      seniority: row.seniority,
      years_experience: row.years_experience,
      matched,
    };
  });

  return { filters, total: candidates.length, complete: true, candidates };
}

/* ---------------------------------------------------------------- get_cv --- */

export interface GetCvResult {
  candidate: CandidateRow;
  skills: { skill: string; category: string }[];
  experience: { company: string; title: string; start_date: string; end_date: string; description: string; page: number }[];
  education: { institution: string; degree: string; field: string; end_year: number }[];
  languages: { language: string; level: string }[];
  full_text: string;
  citation: CitationRef;
}

/**
 * The whole document for one candidate. "Summarize the profile of Jane Doe" is a
 * document-level question; answering it from whichever three chunks happened to
 * rank highest produces a summary with holes in it.
 */
export function getCv({ candidate_id }: { candidate_id: string }): GetCvResult | { error: string; candidate_id: string } {
  const db = getDb();
  const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidate_id) as
    | (CandidateRow & { full_text: string })
    | undefined;

  if (!candidate) {
    return { error: `No candidate with id "${candidate_id}".`, candidate_id };
  }

  return {
    candidate,
    skills: db.prepare('SELECT skill, category FROM skills WHERE candidate_id = ?').all(candidate_id) as unknown as GetCvResult['skills'],
    experience: db
      .prepare('SELECT company, title, start_date, end_date, description, page FROM experience WHERE candidate_id = ?')
      .all(candidate_id) as unknown as GetCvResult['experience'],
    education: db
      .prepare('SELECT institution, degree, field, end_year FROM education WHERE candidate_id = ?')
      .all(candidate_id) as unknown as GetCvResult['education'],
    languages: db.prepare('SELECT language, level FROM languages WHERE candidate_id = ?').all(candidate_id) as unknown as GetCvResult['languages'],
    full_text: candidate.full_text,
    citation: citation(candidate, 1),
  };
}

/* ----------------------------------------------------------- the roster --- */

/**
 * Injected into the system prompt (PRD §7.4). ~400 tokens, and it removes the
 * failure mode where the model cannot spell a candidate's name well enough to
 * search for them.
 */
export function getRoster(): { id: string; name: string; current_title: string; location: string; photo_path: string; years_experience: number }[] {
  return getDb()
    .prepare('SELECT id, name, current_title, location, photo_path, years_experience FROM candidates ORDER BY id')
    .all() as unknown as ReturnType<typeof getRoster>;
}

/* --------------------------------------------------- AI SDK tool wrappers --- */

export const cvTools = {
  search_cvs: tool({
    description:
      'Semantic search over CV content. Use for fuzzy or conceptual questions ' +
      '("who has worked on payment systems?", "experience scaling a platform team"). ' +
      'Returns the top matching passages, not a complete set — for "who has skill X" or ' +
      '"how many", use filter_candidates instead.',
    inputSchema: z.object({
      query: z.string().describe('Natural-language description of what to look for'),
      top_k: z.number().int().min(1).max(MAX_TOP_K).optional().describe('How many passages to return (default 8)'),
    }),
    execute: searchCvs,
  }),

  filter_candidates: tool({
    description:
      'Exact, structured filter over the candidate database. Returns EVERY candidate that ' +
      'matches, with a total count — never a truncated ranking. Use this for aggregation ' +
      '("who has experience with Python?", "how many candidates know Go?"), for exact ' +
      'attributes (university, spoken language, employer, seniority, location), and for ' +
      'numeric constraints. Skills and institutions are alias-aware: "UPC", "k8s" and ' +
      '"Postgres" all resolve correctly. Combine parameters to AND them together. ' +
      'Call with no parameters to list the whole corpus.',
    inputSchema: FilterInputSchema,
    execute: async (input: FilterInput) => filterCandidates(input),
  }),

  get_cv: tool({
    description:
      'Fetch one complete CV: the structured record plus the full document text. ' +
      'Use for "tell me about X", "summarize X", or any question about a single named ' +
      'candidate, so the answer is based on the whole document rather than scattered chunks.',
    inputSchema: z.object({
      candidate_id: z.string().describe('The candidate id, e.g. "cv_017". Take it from the roster in the system prompt.'),
    }),
    execute: async (input: { candidate_id: string }) => getCv(input),
  }),
};

export type CvToolName = keyof typeof cvTools;
