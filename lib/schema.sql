-- Structured half of the index (PRD §9.2).
--
-- Ingest is a full rebuild, not an incremental sync: 30 CVs re-index in seconds,
-- so there is no migration tooling and no upsert path to get wrong.

DROP TABLE IF EXISTS candidates;
DROP TABLE IF EXISTS skills;
DROP TABLE IF EXISTS education;
DROP TABLE IF EXISTS experience;
DROP TABLE IF EXISTS languages;

CREATE TABLE candidates (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  location        TEXT,
  current_title   TEXT,
  seniority       TEXT,
  years_experience INTEGER,
  summary         TEXT,
  photo_path      TEXT,
  pdf_path        TEXT,
  num_pages       INTEGER,
  full_text       TEXT
);

-- skill_norm / institution_norm hold the alias-collapsed form (lib/aliases.ts).
-- Queries filter on the _norm column and display the raw one.
CREATE TABLE skills (
  candidate_id TEXT NOT NULL,
  skill        TEXT NOT NULL,
  skill_norm   TEXT NOT NULL,
  category     TEXT
);

CREATE TABLE education (
  candidate_id     TEXT NOT NULL,
  institution      TEXT NOT NULL,
  institution_norm TEXT NOT NULL,
  degree           TEXT,
  field            TEXT,
  end_year         INTEGER
);

CREATE TABLE experience (
  candidate_id TEXT NOT NULL,
  company      TEXT,
  title        TEXT,
  start_date   TEXT,
  end_date     TEXT,
  description  TEXT,
  page         INTEGER
);

CREATE TABLE languages (
  candidate_id TEXT NOT NULL,
  language     TEXT,
  level        TEXT
);

CREATE INDEX idx_skills_norm  ON skills(skill_norm);
CREATE INDEX idx_skills_cand  ON skills(candidate_id);
CREATE INDEX idx_edu_norm     ON education(institution_norm);
CREATE INDEX idx_edu_cand     ON education(candidate_id);
CREATE INDEX idx_exp_cand     ON experience(candidate_id);
CREATE INDEX idx_lang_cand    ON languages(candidate_id);
