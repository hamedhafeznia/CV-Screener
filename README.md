
CV Screener

An AI-powered CV screening tool that lets you chat with a collection of 30 synthetic CVs.

The system uses RAG and different retrieval tools to answer questions about candidates. Answers include the CV and page number used as the source.

This project was built as a technical task for a Full-Stack AI Engineer role.

Main features

* Search across 30 CVs
* Ask questions in natural language
* Semantic search with vector embeddings
* Structured filtering for exact and aggregation questions
* Full CV retrieval for profile summaries
* Source citations with PDF page numbers
* Streaming responses
* Classic RAG vs tool-based RAG comparison
* Built-in evaluation dataset

The project runs locally with Node.js only. No Docker, Python, or database server is required.

⸻

Setup

Requirements

* Node.js 22+
* A Google Gemini API key

Install dependencies:

npm install

Create your environment file:

cp .env.example .env

Add your API key:

GOOGLE_GENERATIVE_AI_API_KEY=your_api_key

Start the application:

npm run dev

Open:

http://localhost:3000

The index is already included in the repository, so you can start the application without running the ingestion process.

⸻

Rebuild the data

If you want to generate the CVs and rebuild the index from scratch:

npm run check
npx playwright install chromium
npm run generate
npm run ingest

To run the evaluation:

npm run eval

What these commands do

generate
   ↓
Generate 30 synthetic CVs
   ↓
Create PDF files
   ↓
ingest
   ↓
Extract text
   ↓
Parse CV information
   ↓
Create chunks + embeddings
   ↓
SQLite + LanceDB

⸻

How the system works

The system supports three main types of questions:

Question	Type	Best approach
Who has experience with Python?	Aggregation	SQL filter
Which candidate graduated from UPC?	Exact search	SQL + aliases
Summarize Jane Doe’s profile	Whole document	Full CV retrieval

The main idea is simple:

Different questions need different retrieval strategies.

A normal RAG system usually retrieves the top-k most similar chunks. This works well for general semantic questions, but it is not always enough.

For example:

“Who has experience with Python?”

If 19 candidates have Python experience, retrieving only the top 5 chunks cannot reliably return all 19 candidates.

So this project uses three retrieval tools.

⸻

Architecture

                    User
                      |
                      v
                 Chat UI
                      |
                      v
                AI Agent
                      |
          +-----------+-----------+
          |           |           |
          v           v           v
     search_cvs   filter_candidates   get_cv
          |           |           |
          v           v           v
      LanceDB      SQLite        SQLite
      Vector DB    Filters       Full CV
          |           |           |
          +-----------+-----------+
                      |
                      v
                  AI Answer
                      |
                      v
              Sources + Pages

Retrieval tools

Tool	Storage	Used for
search_cvs	LanceDB	Semantic / fuzzy search
filter_candidates	SQLite	Exact filters, counts, and lists
get_cv	SQLite	Full CV and profile summaries

The AI decides which tool to use based on the question.

⸻

Why not use only classic RAG?

Classic RAG normally works like this:

Question
   ↓
Embedding
   ↓
Vector Search
   ↓
Top 5 chunks
   ↓
LLM
   ↓
Answer

This is simple and works well for many questions.

However, it has a problem with questions that need all matching candidates.

For example, in this dataset:

19 candidates have Python experience

A top-5 search can only return up to 5 relevant chunks.

In our evaluation:

Python experience
Tool-based RAG:  19 / 19
Classic RAG:      4 / 19

This is the main reason for using multiple retrieval tools.

⸻

Evaluation

The project includes an evaluation set generated from the same ground-truth data used to create the CVs.

This lets us compare:

* Classic top-k RAG
* Tool-based RAG

Retrieval results

The main result is:

                    Precision    Recall
Tool-based RAG         100%       100%
Classic RAG             62%        65%

For aggregation questions:

Question                         Tool RAG      Classic RAG
Python experience                 19 / 19        4 / 19
Docker experience                 18 / 18        4 / 18
Git experience                    15 / 15        5 / 15
Spanish speakers                   7 / 7         5 / 7

The tool-based approach can return the complete result set instead of only the top-k vector matches.

Negative queries

The evaluation also includes questions where the correct answer is nobody.

For example:

Who worked at Google?

There are no Google employees in the dataset.

The SQL filter correctly returns:

0 candidates

This is important because a vector search can still return similar CVs even when there is no correct match.

⸻

End-to-end evaluation

The evaluation can also run through the real chat flow.

Tool-based RAG
Precision: 100%
Recall:    100%
Classic RAG
Precision: 100%
Recall:     22%

The end-to-end test uses a small number of questions by default because Gemini’s free tier has request limits.

npm run eval

Run only the deterministic retrieval evaluation:

EVAL_E2E=0 npm run eval

Run a larger end-to-end evaluation:

EVAL_E2E=13 npm run eval

⸻

Data and ingestion

The CV dataset is synthetic and generated specifically for this project.

The generator uses a fixed seed and predefined rules to create a diverse dataset.

The corpus includes:

* Different roles and seniority levels
* Different cities and universities
* Different employers
* Different CV layouts
* Two-column CVs
* An image-only CV
* Different languages
* Exact evaluation cases

For example, the dataset contains exactly one UPC graduate and no Google employees. This makes the evaluation predictable and reproducible.

⸻

PDF processing

The ingestion pipeline handles two important PDF cases.

Two-column CVs

Some CVs use a two-column layout.

PDF text extraction can mix content from both columns, so the ingestion process uses the position of text elements to detect the columns before creating the final text.

Image-only CV

One CV does not contain a text layer.

If a page contains very little extracted text, the system uses a vision model to read the page.

⸻

Chunking and embeddings

CVs are split by sections such as:

Profile
Skills
Experience
Education
Languages

Each chunk also includes the candidate’s identity.

For example:

Candidate: Xavier Prieto
Section: Work Experience
Data Scientist, Glovo (2023 - Present)
Own the demand forecasting model...

This makes retrieval and citations more reliable.

The project uses Gemini Embeddings with 768 dimensions and stores the vectors in LanceDB.

⸻

Why SQLite + LanceDB?

The project is designed to run locally with minimal setup.

SQLite

SQLite stores structured candidate information.

It does not require:

* PostgreSQL
* Docker
* A database server

The database file can also be included in the repository.

LanceDB

LanceDB stores the vector embeddings and supports semantic search.

It is also file-based, so no separate vector database server is needed.

For a small local project like this, this keeps the setup simple.

For a production system, PostgreSQL + pgvector would be a stronger option because structured filters and vector search can be handled in the same database.

⸻

Why no LangChain or LlamaIndex?

The retrieval logic in this project is relatively small.

The main parts are:

* Retrieval
* Tool routing
* SQL filtering
* Vector search
* Citations

Keeping these parts directly in the application makes the logic easier to understand and test.

Each retrieval tool is also a normal function, so the evaluation can test it without calling an LLM.

⸻

Project structure

app/
  chat UI
  API routes
components/
  chat
  sidebar
  messages
  sources
  PDF viewer
lib/
  agent.ts          AI agent and tool routing
  tools.ts          Retrieval tools
  llm.ts            LLM provider
  stores.ts         SQLite and LanceDB
  aliases.ts        Skill and university aliases
  schemas.ts        Shared CV schema
  ingest/           PDF processing and indexing
scripts/
  generate.ts       Generate synthetic CVs
  ingest.ts         Build the index
  lib/sampler.ts    Generate reproducible data
  templates/        CV templates
eval/
  Evaluation tests
data/
  cvs/
  photos/
  ground_truth/
  candidates.db
  index.lance

⸻

Known limitations

This is a technical prototype, so there are some limitations.

* SQLite and LanceDB are separate stores, so some complex queries need multiple tool calls.
* PDF extraction is optimized for the three CV templates used in this project.
* The CV parsing step uses an LLM, so incorrect extraction is possible.
* There is no reranker for semantic search.
* Chat history is designed for a local, single-user environment.
* Gemini free-tier limits can affect large evaluations.
* All CVs and candidate information are synthetic.

⸻

Summary

The main idea of this project is:

Use the right retrieval method for the type of question.

Vector search is useful for semantic questions, but it is not always the best solution for exact filters, counting, or retrieving a complete CV.

The system combines:

Vector Search
     +
SQL Filtering
     +
Full Document Retrieval
     =
More reliable CV answers

The evaluation shows that this approach can significantly improve recall for questions that require finding all matching candidates, while still keeping semantic search for questions where it works well.