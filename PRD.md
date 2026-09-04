# CV Screener — Product Requirements Document

An AI-powered CV screening chat application. Built as a technical task for a
Full-Stack AI Engineer role. **Deadline: 2 days.** Runs locally; no deployment required.

> This document is self-contained. A fresh session should be able to build the
> entire project from it without additional context. Section 16 records *why*
> each decision was made — read it before proposing alternatives.

---

## 1. Goal

Build an end-to-end prototype that lets a user chat with a collection of ~30 fake CVs:

1. **Generate** 25–30 realistic fake CVs as PDFs (LLM-written text + AI-generated headshots).
2. **Ingest** those PDFs into a retrievable store (RAG pipeline).
3. **Chat** — a web UI where answers are grounded in the CVs and cite their sources.

### Must answer these three questions correctly (the grader's own examples)

| Question | Question type | Required behaviour |
|---|---|---|
| "Who has experience with Python?" | Aggregation over corpus | Return **all** matching candidates, not top-k |
| "Which candidate graduated from UPC?" | Exact / alias filter | Match acronym against full institution name |
| "Summarize the profile of Jane Doe." | Whole-document fetch | Retrieve the full CV, not scattered chunks |

These three shapes drive the entire retrieval design (§7).

---

## 2. Deliverables & acceptance criteria

| # | Deliverable | Acceptance criteria |
|---|---|---|
| D1 | GitHub repo | Public. `README.md` with architecture, setup, and design rationale. |
| D2 | 25–30 CV PDFs | Committed under `data/cvs/`. Realistic. Include headshot, contact info, experience, skills, education. ≥3 distinct visual templates. |
| D3 | Working app | `npm install && npm run dev` → working chat, using the **committed** index. No ingest required. |
| D4 | Source citations | Every answer cites candidate + page; clicking a citation opens the actual PDF at that page. |
| D5 | Eval harness | `npm run eval` prints precision/recall for agentic vs classic RAG. |
| D6 | Video < 5 min | Pipeline walkthrough → live demo → technical highlight. Script in §14. |
| D7 | Architecture diagram | Committed as `docs/architecture.png` or inline Mermaid in README. |

**Definition of done:** a reviewer clones the repo, adds one API key, runs two
commands, and correctly answers all three questions in §1 within 60 seconds.

---

## 3. Architecture

```
OFFLINE (run once, output committed to git)
┌──────────────────────────────────────────────────────────────────┐
│ scripts/generate.ts                                              │
│   seeded sampler → LLM (structured output) → CVProfile JSON      │
│         │                                    │                   │
│         ├─→ Gemini image → headshot.png      │                   │
│         └─→ 1 of 3 HTML templates ──→ Playwright ──→ cv_NNN.pdf  │
│                                              └─→ ground_truth/   │
├──────────────────────────────────────────────────────────────────┤
│ scripts/ingest.ts                                                │
│   PDF → unpdf text (per page)                                    │
│       → LLM structured extraction → CVProfile                    │
│       → section-aware chunks (identity-prefixed)                 │
│       → gemini-embedding-001                                     │
│       → SQLite (facts)  +  LanceDB (vectors)                     │
└──────────────────────────────────────────────────────────────────┘

RUNTIME (Next.js, single process)
┌──────────────────────────────────────────────────────────────────┐
│ POST /api/chat  →  streamText(model, tools, messages)            │
│                                                                   │
│      ┌──────────────────┬──────────────────┬──────────────────┐  │
│      │ search_cvs()     │ filter_          │ get_cv()         │  │
│      │ vector ANN       │ candidates()     │ full document    │  │
│      │ over LanceDB     │ SQL over SQLite  │ by id            │  │
│      └──────────────────┴──────────────────┴──────────────────┘  │
│                            ↓                                      │
│      streamed events: tool-call → tool-result → text → sources    │
│                            ↓                                      │
│ useChat() → tool chips · answer · source cards · PDF dialog       │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Tech stack

| Layer | Choice | Package |
|---|---|---|
| Framework | Next.js 15 (App Router), TypeScript | `next` |
| LLM orchestration | Vercel AI SDK | `ai`, `@ai-sdk/google` |
| Text model | `gemini-3.5-flash` (free tier) | — |
| Embeddings | `gemini-embedding-001`, 768 dims | — |
| Image model | `gemini-3.1-flash-image` (**paid**, ~$1 total) | — |
| Structured store | `node:sqlite` (Node ≥22 built-in, zero deps) | — |
| Vector store | LanceDB (embedded, file-based) | `@lancedb/lancedb` |
| PDF generation | Playwright → Chromium | `playwright` |
| PDF extraction | pdf.js wrapper | `unpdf` |
| Schemas / validation | Zod (tool params + structured output) | `zod` |
| Styling | Tailwind v4 + shadcn/ui | `tailwindcss` |
| Icons | `lucide-react` | — |
| Eval | Vitest | `vitest` |

**Single runtime, single `package.json`, single `npm run dev`.** No Python, no
Docker, no database server, no LangChain.

> Free-tier text models (any is fine): `gemini-3.8-flash`, `gemini-3.7-flash`,
> `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`,
> `gemini-2.5-pro`, `gemini-2.5-flash`.
> **Image generation is not on the free tier** — budget ~$1 for 30 headshots.

---

## 5. Part 1 — CV generation pipeline

### 5.1 The problem to solve

Prompting an LLM for "30 realistic CVs" produces 30 near-identical mid-level
software engineers with interchangeable names. **Diversity must be enforced by a
sampler in code, not requested in a prompt.**

### 5.2 Pipeline

1. **Seeded sampler** (`scripts/lib/sampler.ts`) — with a fixed seed, draw a spec per CV:
   `{ role, seniority, years, city, university, languages, skills_bias, template_id, photo_hint }`
   from curated pools. Guarantees spread across roles (backend, data, ML, frontend,
   DevOps, PM, designer, QA), seniority (junior→principal), geography, and universities.
2. **LLM fill** — pass the spec to the model with a **Zod-constrained structured
   output** matching `CVProfile` (§9.1). Never freeform text.
3. **Headshot** — one Gemini image call per candidate, prompt derived from
   `photo_hint`. Save to `data/photos/{id}.png`. Cache by id; never regenerate.
4. **Render** — inject `CVProfile` into one of **3 HTML/CSS templates**
   (classic single-column, two-column sidebar, modern) → Playwright → `data/cvs/{id}.pdf`.
5. **Persist ground truth** — write the `CVProfile` JSON to
   `data/ground_truth/{id}.json`. This is the eval oracle (§12).

### 5.3 Deliberate hard cases

Include, to exercise the extraction path and to have something to discuss on camera:
- 2–3 CVs using the **two-column template** (naive text extraction interleaves columns).
- **1 CV rendered as a flattened image** (no embedded text) → forces the vision fallback.
- 2–3 CVs in a **non-English language** (e.g. Spanish) → tests cross-lingual retrieval.

---

## 6. Part 2 — Ingest pipeline

`scripts/ingest.ts` runs 5 stages. Each is idempotent and cached by file hash in
`data/.cache/{sha256}.json`, so re-runs don't burn free-tier quota.

| Stage | Module | Detail |
|---|---|---|
| 1. Extract | `lib/ingest/extract.ts` | `unpdf` → text per page. Sort text items by (column, y, x) for two-column layouts. If a page yields < 50 chars, render it to PNG and send to **Gemini vision** as the fallback. |
| 2. Parse | `lib/ingest/parse.ts` | LLM structured output → `CVProfile`. Same Zod schema as generation. |
| 3. Normalize | `lib/ingest/normalize.ts` | Lowercase + alias-expand institutions and skills (§6.1). |
| 4. Chunk | `lib/ingest/chunk.ts` | Section-aware, identity-prefixed (§6.2). |
| 5. Index | `lib/ingest/index.ts` | Embed all chunks (`embedMany`, `RETRIEVAL_DOCUMENT`), write SQLite + LanceDB. |

Ingest is a **full rebuild** (`DROP TABLE IF EXISTS`), not an incremental sync.
No migration tooling.

### 6.1 Normalization (do not skip — the "UPC" question depends on it)

Store both the raw and normalized form. `"Universitat Politècnica de Catalunya"`
must match a query for `"UPC"`. Same for skills: `PostgreSQL` / `Postgres` / `psql`.

Maintain a small hand-written alias map (`lib/aliases.ts`) covering the
universities and skills the sampler actually emits — you control the corpus, so
this is a ~40-line file, not an open-ended problem.

### 6.2 Chunking

Chunk by **semantic section**, and split Work Experience **per role**. Do not use
fixed-size sliding windows. Prefix every chunk with its identity before embedding,
so no chunk is anonymous:

```
Candidate: Jane Doe (cv_017) — Section: Work Experience
Senior Backend Engineer, Glovo (2021–2024). Led migration of the order
service to Kubernetes, reducing p99 latency by 40%...
```

Expect ~8–12 chunks per CV, ~300 total.

### 6.3 Embeddings

- Model `gemini-embedding-001`, **`outputDimensionality: 768`** (Matryoshka
  truncation — ~1 MB index instead of ~4 MB, negligible quality loss at this scale).
- **`taskType: 'RETRIEVAL_DOCUMENT'` at ingest, `'RETRIEVAL_QUERY'` at query time.**
  These are asymmetric; using one for both measurably hurts recall.

---

## 7. Part 3 — Retrieval & chat API

### 7.1 Retrieval strategy: tool-routed ("agentic") RAG

Classic single-shot RAG (embed → top-k → stuff) **fails** on this corpus:
top-k caps recall on aggregation questions, and embeddings blur near-identical
acronyms. So the model routes between three retrievers instead of always calling one.

All three legs are retrieval; vector search remains the primary path for fuzzy
questions. Classic RAG is the degenerate case of this design with one tool.

### 7.2 The three tools (`lib/tools.ts`)

Defined with Zod. **The model never writes SQL.**

```ts
search_cvs({ query: string, top_k?: number = 8 })
  // Embed query (RETRIEVAL_QUERY) → ANN over LanceDB.
  // For fuzzy/conceptual questions.

filter_candidates({ skill?, institution?, min_years?, max_years?,
                    language?, title_contains?, location? })
  // Parameterized SQL over SQLite. Returns ALL matches + total count.
  // For aggregation and exact filters.

get_cv({ candidate_id: string })
  // Full document text + structured record. For summarization.
```

Every tool returns `{ candidate_id, name, current_title, pdf_path, page }` on each
result so citations survive to the UI.

**Security:** tool arguments are LLM-generated, i.e. untrusted input.
Use typed parameters and `?` placeholders — never string interpolation, and never
expose a `run_sql(query)` tool.

### 7.3 Agentic loop

`streamText` with the three tools and a multi-step stop condition capped at
**5 steps**. Stream tool-call and tool-result parts to the client — do not hide them.

### 7.4 System prompt requirements

- Answer **only** from tool results. If nothing matches, say so explicitly.
- Always cite `candidate_id` inline.
- Prefer `filter_candidates` for "who has X" / "how many"; `search_cvs` for
  conceptual queries; `get_cv` for "tell me about X".
- **Inject the candidate roster** (30 `id: name — title` lines, ~400 tokens).
  Cheap, and it removes the failure mode where the model can't spell a name well
  enough to search for it.

### 7.5 Routes

| Route | Purpose |
|---|---|
| `POST /api/chat` | Streaming chat. Body `{ messages, mode?: 'agentic' \| 'classic' }` |
| `GET /api/candidates` | Roster for the sidebar |
| `GET /api/cv/[id]` | Serve the PDF (for citation dialog) |

Stateless — the client holds history and posts the full array each turn.

### 7.6 Classic mode

Implement `mode: 'classic'` — embed → top-5 → stuff → answer, no tools. ~30 lines.
It exists so the eval harness can **measure** the improvement rather than assert it.

---

## 8. Part 4 — Frontend & design system

### 8.1 Principle

This is an **internal recruiting tool**, not a ChatGPT clone. Restrained,
information-dense, neutral. The design's job is to make the retrieval *visible*.

### 8.2 Tokens (`app/globals.css`)

```css
@theme {
  --color-bg:        oklch(0.99 0 0);
  --color-surface:   oklch(0.97 0.002 250);
  --color-border:    oklch(0.92 0.004 250);
  --color-text:      oklch(0.22 0.01 250);
  --color-muted:     oklch(0.55 0.01 250);
  --color-accent:    oklch(0.52 0.13 240);
  --color-accent-bg: oklch(0.96 0.02 240);

  --text-xs:   0.75rem;   /* tool chips, page badges */
  --text-sm:   0.875rem;  /* sidebar, source cards */
  --text-base: 1rem;      /* chat body */
  --text-lg:   1.25rem;   /* the one heading */

  --radius: 0.5rem;
}
```

Four type sizes, one radius, one accent. Dark mode via the same vars under `.dark`.
Fonts: **Geist + Geist Mono** (ships with `create-next-app`). Mono carries
candidate IDs, tool arguments, page numbers.

### 8.3 Visual hierarchy

| Tier | Element | Treatment |
|---|---|---|
| Primary | The answer | 16px, full color, generous leading, **full-width, no bubble** |
| Secondary | Source cards | 14px, bordered, accent-tinted, clickable → PDF dialog |
| Tertiary | Tool-call chips | 12px mono, muted, collapsed by default |

Tool chips present but quiet is the point: they prove real retrieval without
competing with the answer.

### 8.4 Components (7 — install only these shadcn primitives)

`Button, Textarea, Card, Badge, Avatar, ScrollArea, Dialog`

1. **`Message`** — user: right-aligned, subtle fill, `max-w-[80%]`. Assistant: full-width.
2. **`ToolCallChip`** — `⌗ filter_candidates · skill=python → 18 matches`. Expandable.
3. **`SourceCard`** — headshot, name, current title, `p.2` badge → opens PDF dialog.
4. **`CandidateSidebar`** — 280px, 30 avatar rows, live filter input.
5. **`SuggestedQuestions`** — 4 chips on empty state, seeded with the §1 questions.
6. **`PdfDialog`** — `<iframe src={`${pdf}#page=${n}`}>`.
7. **`EmptyState`** — "30 CVs indexed" + suggested chips.

**Reuse the generated headshots** in the sidebar and every source card. Free polish,
and it visually closes the loop between the generation pipeline and the UI.

### 8.5 Layout

```
┌──────────┬─────────────────────────────┐
│ Sidebar  │  Chat (max-w-3xl, centered) │
│ 280px    │  answer                     │
│ 30 cands │  ⌗ tool chip                │
│ + filter │  [src] [src] [src]          │
│          │  [ input ]            [↵]   │
└──────────┴─────────────────────────────┘
```

**Skip:** Storybook, a tokens package, Framer Motion, custom icons, a component library.

---

## 9. Data schemas

### 9.1 `CVProfile` (Zod — shared by generation, ingest, and eval)

```ts
const CVProfile = z.object({
  id: z.string(),                       // "cv_017"
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  location: z.string(),
  current_title: z.string(),
  seniority: z.enum(['junior','mid','senior','lead','principal']),
  years_experience: z.number(),
  summary: z.string(),
  skills: z.array(z.object({ name: z.string(), category: z.string() })),
  experience: z.array(z.object({
    company: z.string(), title: z.string(),
    start_date: z.string(), end_date: z.string(),
    description: z.string(),
  })),
  education: z.array(z.object({
    institution: z.string(), degree: z.string(),
    field: z.string(), end_year: z.number(),
  })),
  languages: z.array(z.object({ language: z.string(), level: z.string() })),
});
```

### 9.2 SQLite (`lib/schema.sql`)

```sql
DROP TABLE IF EXISTS candidates;
DROP TABLE IF EXISTS skills;
DROP TABLE IF EXISTS education;
DROP TABLE IF EXISTS experience;
DROP TABLE IF EXISTS languages;

CREATE TABLE candidates (
  id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, location TEXT,
  current_title TEXT, seniority TEXT, years_experience INTEGER,
  summary TEXT, photo_path TEXT, pdf_path TEXT, num_pages INTEGER,
  full_text TEXT
);
CREATE TABLE skills     (candidate_id TEXT, skill TEXT, skill_norm TEXT, category TEXT);
CREATE TABLE education  (candidate_id TEXT, institution TEXT, institution_norm TEXT,
                         degree TEXT, field TEXT, end_year INTEGER);
CREATE TABLE experience (candidate_id TEXT, company TEXT, title TEXT,
                         start_date TEXT, end_date TEXT, description TEXT);
CREATE TABLE languages  (candidate_id TEXT, language TEXT, level TEXT);

CREATE INDEX idx_skills_norm ON skills(skill_norm);
CREATE INDEX idx_edu_norm    ON education(institution_norm);
```

### 9.3 LanceDB table `cv_chunks`

`{ chunk_id, candidate_id, candidate_name, section, page, text, vector: Float32[768] }`

---

## 10. Repo layout

```
app/
  api/chat/route.ts          streamText + tools, streams tool events
  api/candidates/route.ts
  api/cv/[id]/route.ts       serve PDF for citation dialog
  page.tsx                   useChat UI
  globals.css                design tokens
components/                  the 7 components from §8.4
lib/
  llm.ts                     provider wrapper — only file that knows it's Gemini
  tools.ts                   3 Zod tool definitions + implementations
  stores.ts                  node:sqlite + LanceDB clients
  schemas.ts                 CVProfile + shared types
  aliases.ts                 institution + skill alias map
  schema.sql
  ingest/                    extract · parse · normalize · chunk · index
scripts/
  generate.ts                sampler → LLM → templates → Playwright → PDF
  ingest.ts                  orchestrates lib/ingest/*
  lib/sampler.ts
  templates/                 3 HTML/CSS CV templates
eval/
  questions.ts               ~15 Q&A derived from ground truth
  run.test.ts                precision/recall, agentic vs classic
data/
  cvs/*.pdf                  ✅ commit  (~6 MB)
  photos/*.png               ✅ commit
  ground_truth/*.json        ✅ commit  (eval oracle)
  candidates.db              ✅ commit  (~1 MB)
  index.lance/               ✅ commit  (~1 MB @ 768 dims)
  .cache/                    ❌ gitignore
docs/architecture.png
.env.example
README.md
```

Total repo ≈ 15 MB. Fine for GitHub.

**Committing the built index is a requirement, not an optimization.** Since the
app isn't deployed, the reviewer's local run *is* the product. They must not have
to run a quota-limited ingest before seeing anything work.

---

## 11. Environment & setup

```bash
# rename the folder first — it currently has a trailing space
npm install
npx playwright install chromium     # generation only (~150 MB)
cp .env.example .env                # add GEMINI_API_KEY
```

`.env.example`:
```
GOOGLE_GENERATIVE_AI_API_KEY=
LLM_MODEL=gemini-3.5-flash
EMBED_MODEL=gemini-embedding-001
IMAGE_MODEL=gemini-3.1-flash-image
```

Scripts:
```json
{
  "generate": "tsx scripts/generate.ts",
  "ingest":   "tsx scripts/ingest.ts --rebuild",
  "dev":      "next dev",
  "eval":     "vitest run eval"
}
```

Requires Node ≥ 22 (for `node:sqlite`). Verified working on Node 24.15.
Pin it so a reviewer on an older Node fails loudly instead of confusingly:
`"engines": { "node": ">=22" }` in `package.json`, plus a `.nvmrc` containing `22`.

No Python, no Docker, no database server.

---

## 12. Evaluation harness

The differentiator almost nobody ships in a take-home. **You generated the CVs, so
you have perfect ground truth.**

1. `eval/questions.ts` derives ~15 questions and their exact answers
   *programmatically* from `data/ground_truth/*.json` — e.g. compute the true set of
   Python candidates by scanning the JSON, then ask the app "Who has experience with Python?"
2. Cover all three question shapes from §1, plus: multi-constraint
   ("senior engineers in Barcelona who know Go"), negative cases
   ("who worked at Google?" when nobody did — must refuse, not hallucinate).
3. Score **precision / recall** on the set of candidate IDs cited.
4. Run **both modes** and report the delta.

Expected headline result: classic top-k RAG recovers a fraction of the true
Python set; agentic recovers all of it. That measured claim is far stronger on
camera than an architectural assertion.

---

## 13. Build order

19 phases across 6 stages. **Each phase is one short, self-contained step that ends
in a verifiable state** — run the check, confirm it works, then commit. Never commit
a phase whose check hasn't passed; that's what makes incremental commits safe.

Suggested commit messages use Conventional Commits.

### Stage A — Foundation

| # | Build | Check | Commit |
|---|---|---|---|
| **P0** | `create-next-app` (TS, Tailwind v4, App Router). `.nvmrc`, `engines`, `.gitignore`, `.env.example`. | `npm run dev` serves the default page | `chore: scaffold Next.js app with Tailwind and env config` |
| **P1** | `lib/schemas.ts` (`CVProfile` Zod), `lib/aliases.ts`, `lib/llm.ts` (provider wrapper). | A throwaway script calls the model and prints a reply | `feat: shared schemas, alias map, and LLM provider wrapper` |

### Stage B — CV generation → *delivers D2*

| # | Build | Check | Commit |
|---|---|---|---|
| **P2** | `scripts/lib/sampler.ts` — seeded spec sampler. | Prints 30 visibly diverse specs; identical across two runs | `feat: seeded CV spec sampler` |
| **P3** | Spec → `CVProfile` via structured output. Write `data/ground_truth/*.json`. | 30 JSON files; skim 3 for realism and variety | `feat: generate CV profiles via structured output` |
| **P4** | Headshot generation, cached by id, never regenerated. | 30 PNGs in `data/photos/` | `feat: generate candidate headshots` |
| **P5** | 3 HTML/CSS templates + Playwright render. | 30 PDFs; open one of each template, photos embedded | `feat: render CV PDFs from templates via Playwright` |

### Stage C — Ingest → *index built*

| # | Build | Check | Commit |
|---|---|---|---|
| **P6** | `lib/ingest/extract.ts` — per-page text, column-aware ordering, vision fallback. | Dump text for a two-column CV; reading order is correct | `feat: PDF text extraction with column ordering and vision fallback` |
| **P7** | `lib/ingest/parse.ts` + `normalize.ts` + hash cache. | Diff 3 parsed profiles against their ground truth | `feat: LLM structured extraction with normalization and cache` |
| **P8** | `lib/schema.sql`, `lib/stores.ts` (SQLite + LanceDB clients). | Tables create; insert/select round-trips | `feat: SQLite and LanceDB store clients` |
| **P9** | `chunk.ts`, `index.ts`, wire `scripts/ingest.ts`. | `npm run ingest` builds both stores; a manual vector query returns sane hits | `feat: section-aware chunking and vector indexing` |
| **P9b** | — | `data/candidates.db` + `data/index.lance/` are tracked | `chore: commit built search index` |

### Stage D — Retrieval & API → *delivers D3, D5* ⚠️ **the de-risking milestone**

| # | Build | Check | Commit |
|---|---|---|---|
| **P10** | `lib/tools.ts` — the 3 tools as plain functions, callable without an LLM. | `filter_candidates({skill:'python'})` returns the **complete** set; `get_cv` returns a full doc | `feat: three retrieval tools (semantic, filter, document)` |
| **P11** | `app/api/chat/route.ts` — `streamText`, tools, system prompt, roster injection. | `curl` the endpoint: all three §1 questions answered correctly with citations | `feat: streaming chat API with tool-routed retrieval` |
| **P12** | `mode: 'classic'` — embed → top-5 → stuff. | Same question, visibly worse recall | `feat: classic top-k RAG mode for comparison` |
| **P13** | `eval/questions.ts` from ground truth + `eval/run.test.ts`. | `npm run eval` prints precision/recall for both modes | `test: eval harness comparing agentic vs classic RAG` |

> **Reach P11 before building any UI.** Retrieval correctness is the only real
> technical risk in this project. Once the API answers all three questions, everything
> that follows is presentation, and you can trade it off against the clock freely.

### Stage E — Interface → *delivers D4*

| # | Build | Check | Commit |
|---|---|---|---|
| **P14** | Design tokens in `globals.css`, app shell, `CandidateSidebar` + `/api/candidates`. | 30 candidates render with headshots; filter works | `feat: design tokens and app shell with candidate sidebar` |
| **P15** | `useChat` + `Message`, streaming. | Ask a question, watch tokens stream in | `feat: streaming chat interface` |
| **P16** | `ToolCallChip`, `SourceCard`, `PdfDialog`, `/api/cv/[id]`. | Chips appear live during retrieval; clicking a source opens the PDF at the cited page | `feat: tool-call chips, source cards, and PDF citation viewer` |
| **P17** | `EmptyState` + `SuggestedQuestions`. | Click a suggested chip → correct answer, no typing | `feat: empty state with suggested questions` |

### Stage F — Ship → *delivers D1, D6, D7*

| # | Build | Check | Commit |
|---|---|---|---|
| **P18** | README (§15) + architecture diagram. | Fresh clone → 3 commands → working chat | `docs: README with architecture and design rationale` |

Then record the video (§14).

### If the clock runs out

Cut in this order: non-English CVs → the image-only CV → dark mode → P12/classic mode
→ P17. **Never cut P13 (eval) or P16 (citations)** — those are the two highest-signal
pieces of the entire submission.

---

## 14. Video script (< 5 min)

| Time | Segment | Content |
|---|---|---|
| 0:00–0:45 | Generation | Show the seeded sampler. "Prompting for 30 CVs gives you 30 identical people — diversity is enforced in code." Show 3 rendered PDFs side by side. |
| 0:45–1:30 | Architecture | The §3 diagram. Structured extraction → SQLite; chunks → LanceDB. Why two stores. |
| 1:30–3:00 | Demo | Their three questions, live. Point at the tool chips as they stream: "it chose the SQL filter here, not vector search." Click a citation → PDF opens at the cited page. |
| 3:00–4:15 | **Technical highlight** | The core argument: naive top-k RAG *structurally cannot* answer "who has Python?" — it caps recall at k. Show the eval output: classic vs agentic recall. This is the strongest 75 seconds; rehearse it. |
| 4:15–5:00 | Judgment | Why no LangChain. Why SQLite not Postgres. "At 30 CVs you could skip retrieval entirely and stuff a 1M-context window — I built retrieval because it's what survives at 30,000." Note pgvector as the production path. |

---

## 15. README requirements

1. Architecture diagram + one-paragraph explanation.
2. Setup: 3 commands, working in under 2 minutes.
3. **"Why tool-routed RAG"** — the §7.1 argument with the eval numbers.
4. **"Why no LangChain"** — evaluated LangChain and LlamaIndex; for a single-corpus
   pipeline with custom hybrid retrieval, the abstraction cost exceeded the savings,
   and direct SDK tool calling kept retrieval logic explicit and testable.
5. **"Why SQLite, not Postgres"** — file-based means the index ships in the repo and
   the app runs with zero infrastructure; pgvector is the production path because it
   unifies metadata filtering and vector search into one pre-filtered query.
6. Known limitations, honestly stated.

---

## 16. Decisions log

Read before proposing changes. Each was considered and settled.

| Decision | Rationale |
|---|---|
| **Node/TypeScript, not Python** | Removes the two-runtime tax (venv, CORS, two dev servers) on a 2-day clock. The Vercel AI SDK provides the agentic loop *and* streams tool-call events to `useChat` — which is exactly the feature that makes retrieval visible in the demo. Type/Zod sharing across API and UI. Playwright is natively a Node tool. Cost: weaker PDF extraction than PyMuPDF — acceptable because we generate the PDFs ourselves, so text is clean and embedded. |
| **Tool-routed RAG, not classic top-k** | Two of the three grader questions are unanswerable by top-k retrieval (recall cap; acronym blur). Vector search is retained as one of three routes. |
| **No LangChain / LlamaIndex** | The graded artifact is the chunking strategy, retriever routing, tool loop, and citation plumbing — a framework hides all of it behind `create_retrieval_chain`. The loop is ~40 lines. Mixed SQL + vector retrieval with custom citation payloads is exactly where you end up subclassing framework internals. State this as a deliberate choice in the README. |
| **SQLite, not Postgres** | A SQLite file can be committed to git; a Postgres database cannot. That single property is what lets a reviewer clone and run in two commands. 30 rows, one local user. `node:sqlite` is built into Node 24 — zero deps, no server, no Docker. |
| **LanceDB, not pgvector/Chroma/Qdrant** | File-based, no server (no Docker on this machine), official Node bindings, built-in hybrid + FTS. At 300 chunks a numpy-style brute-force scan would also work — LanceDB is the version that scales and shows tool familiarity. |
| **Two stores, not one** | Accepted tradeoff: pgvector would unify filter + ANN into one pre-filtered query. Not worth a database server for a local prototype. Say so on camera. |
| **Typed tool params, not text-to-SQL** | Tool arguments are LLM-generated, i.e. untrusted input reaching SQL. Typed params + `?` placeholders. Text-to-SQL buys nothing at this scale and hands the model a shell. |
| **Commit the built index** | No deployment means the reviewer's local run is the product. Never put a quota-limited ingest between them and a working demo. Keep ingest reproducible via `--rebuild`, just not mandatory. |
| **Full rebuild ingest, no migrations** | 30 CVs rebuild in seconds. Incremental upserts are over-engineering. |
| **Section-aware, identity-prefixed chunks** | CVs have natural boundaries. An anonymous chunk reading "led the migration to Kubernetes" cannot be attributed or cited. |
| **Seeded sampler for diversity** | LLMs collapse to the mode. Diversity is a code problem, not a prompting problem. It also makes generation reproducible. |
| **Ground truth → eval harness** | Generating the corpus yields a free oracle. Turns "my architecture is better" into a measured number. Highest-signal, lowest-cost differentiator available. |
| **768-dim embeddings** | Matryoshka truncation. ~1 MB index vs ~4 MB, negligible quality loss at this scale, smaller git repo. |
| **No Docker** | Nothing to containerize: one Next.js process, no DB server, no second runtime. It would only worsen the reviewer experience that *is* the deliverable (Docker Desktop install, build wait, arch mismatches, volume mounts, and Chromium system libs for Playwright). The one real risk it would have mitigated — wrong Node version — is solved by `engines` + `.nvmrc`. Deployment answer, if asked: push to Vercel; containers only matter once the stores move to Postgres + pgvector. |
| **Restrained design, not a ChatGPT clone** | It's an internal recruiting tool. Information-dense and neutral reads as more considered — and makes the tool chips and citations the visual story. |

---

## 17. Non-goals

Authentication · multi-user support · deployment/hosting · incremental re-indexing ·
conversation persistence · real CV data (all data is synthetic) · resume ranking or
scoring · ATS integration · reranking models · fine-tuning · Docker / containerization.
