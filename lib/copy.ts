import { FileText, Filter, Search } from 'lucide-react';

/**
 * Every user-facing string in the interface.
 *
 * Kept in one place so the wording can be reviewed and revised as prose rather
 * than hunted through JSX, and so nothing accidentally ships in two voices.
 * Anything with a variable in it is a function, which keeps interpolation and
 * pluralisation next to the sentence they belong to instead of scattered across
 * the components.
 *
 * Scope is the UI only. Model-facing text — the system prompt, the tool
 * descriptions, the extraction instructions — lives in `lib/agent.ts` and
 * `lib/tools.ts`, because that is prompt engineering rather than copy, and it is
 * read alongside the logic it steers.
 */

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export const COPY = {
  app: {
    name: 'cv-screener',
    title: 'CV Screener',
    description: 'Chat with a corpus of CVs. Every answer cites the PDF it came from.',
  },

  header: {
    corpus: (count: number) => `${count || '—'} CVs`,
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    modes: { agentic: 'agentic', classic: 'classic' } as const,
  },

  sidebar: {
    tabs: { resumes: 'Resumes', chats: 'Chats' },
    filterPlaceholder: 'Filter',
    filterLabel: 'Filter candidates',
    newChat: 'New chat',
    noIndex: 'No index built yet.',
    noMatch: (query: string) => `Nothing matches “${query}”.`,
    noChats: 'No saved chats yet. Ask a question and it will appear here.',
    historyUnavailable: (reason: string) => `Chat history unavailable: ${reason}`,
    deleteChat: (title: string) => `Delete chat: ${title}`,
    years: (years: number) => `${years}y`,
  },

  chat: {
    inputPlaceholder: 'Ask about skills, universities, languages, or one candidate…',
    inputLabel: 'Ask a question about the CVs',
    send: 'Send',
    stop: 'Stop',
    meta: (model: string | undefined, chunks: number | undefined) => ({
      model: model ?? '—',
      chunks: `${chunks ?? '—'} chunks`,
    }),
  },

  empty: {
    heading: 'Ask about the candidates.',
    body:
      'Answers come only from the indexed CVs. The model picks its own retriever for each question — ' +
      'an exact SQL filter, semantic search, or a whole-document fetch — and every answer cites the PDF ' +
      'and page it came from.',
    indexed: (candidates: number, chunks?: number) =>
      `${candidates} CVs · ${chunks ?? '—'} chunks · SQLite + LanceDB`,
    notBuilt: 'index not built',
    /**
     * Seeded with the three questions from the brief, so the first thing anyone
     * does with the app is the exact thing it was built to do. Each is labelled
     * with the retrieval shape it exercises, which is the point being made.
     */
    suggestions: [
      { question: 'Who has experience with Python?', shape: 'aggregation over the corpus', icon: Filter },
      { question: 'Which candidate graduated from UPC?', shape: 'exact match on an acronym', icon: Filter },
      { question: 'Summarize the profile of Xavier Prieto.', shape: 'whole-document fetch', icon: FileText },
      { question: 'Who has scaled a platform team with Kubernetes?', shape: 'semantic search', icon: Search },
    ],
  },

  /** Live status while a turn is in flight. See components/Thinking.tsx. */
  thinking: {
    unknownModel: 'the model',
    asking: (model: string) => `Asking ${model}`,
    writing: (model: string) => `Waiting for ${model} to write the answer`,
    /** Where the current wait actually is — an API round trip, or local disk. */
    source: { model: 'api', local: 'local index' },
    tools: {
      filter_candidates: 'Filtering candidates',
      get_cv: 'Reading the full CV',
      search_cvs: 'Embedding the query and searching chunks',
    } as Record<string, string>,
  },

  /** The collapsed tool-activity row above an answer. */
  trace: {
    tools: (count: number) => plural(count, 'tool', 'tools'),
    steps: (count: number) => plural(count, 'step', 'steps'),
    progress: (done: number, total: number) => `${done}/${total}`,
    seconds: (value: number) => `${value.toFixed(1)}s`,
    failed: 'failed',
    matches: (count: number) => plural(count, 'match', 'matches'),
    passages: (count: number) => plural(count, 'passage', 'passages'),
    fullCv: (name?: string) => (name ? `full CV · ${name}` : 'full CV'),
  },

  sources: {
    openCv: (name: string, page: number) => `Open ${name}'s CV${page > 1 ? `, page ${page}` : ''}`,
    chipTitle: (name: string, title: string, page: number) => `${name} — ${title || 'CV'}, page ${page}`,
    page: (page: number) => `p.${page}`,
    more: (count: number) => `+${count} more`,
  },

  pdf: {
    loading: 'Loading the CV…',
    cited: (page: number) => `Cited from page ${page}`,
    openInNewTab: 'Open in new tab',
    close: 'Close',
    frameTitle: (name: string, page: number) => `${name} CV, page ${page}`,
    subtitle: (candidateId: string, page: number) => `${candidateId}.pdf · page ${page}`,
  },

  errors: {
    rosterFailed: 'Failed to load the roster.',
  },
} as const;
