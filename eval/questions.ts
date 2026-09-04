import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { normalizeInstitution, normalizeSkill } from '../lib/aliases';
import { CVProfileSchema, type CVProfile } from '../lib/schemas';

/**
 * The eval oracle (PRD §12).
 *
 * We generated this corpus, so we have perfect ground truth for it. Every
 * question below is *derived* from `data/ground_truth/*.json` rather than
 * hand-written: the expected answer to "who has experience with Python?" is
 * computed by scanning the JSON, so it stays correct if the corpus is
 * regenerated and it cannot drift out of sync with what was indexed.
 */

const TRUTH_DIR = path.join(process.cwd(), 'data/ground_truth');

export type QuestionShape =
  | 'aggregation'
  | 'exact-filter'
  | 'document'
  | 'multi-constraint'
  | 'negative';

export interface EvalQuestion {
  id: string;
  question: string;
  shape: QuestionShape;
  /** The complete, correct set of candidate ids. Empty means "nobody". */
  expected: string[];
  /** Why this question is in the set — printed in the report. */
  note: string;
}

export function loadGroundTruth(): CVProfile[] {
  const files = readdirSync(TRUTH_DIR).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) {
    throw new Error(`No ground truth in ${TRUTH_DIR}. Run \`npm run generate\` first.`);
  }
  return files.map((file) => CVProfileSchema.parse(JSON.parse(readFileSync(path.join(TRUTH_DIR, file), 'utf8'))));
}

const city = (profile: CVProfile) => profile.location.split(',')[0].trim();

function withSkill(corpus: CVProfile[], skill: string): string[] {
  const target = normalizeSkill(skill);
  return corpus.filter((p) => p.skills.some((s) => normalizeSkill(s.name) === target)).map((p) => p.id).sort();
}

function withInstitution(corpus: CVProfile[], institution: string): string[] {
  const target = normalizeInstitution(institution);
  return corpus.filter((p) => p.education.some((e) => normalizeInstitution(e.institution) === target)).map((p) => p.id).sort();
}

/** Skills that split the corpus usefully — not universal, not unique. */
function informativeSkills(corpus: CVProfile[], count: number): string[] {
  const tally = new Map<string, { raw: string; ids: Set<string> }>();
  for (const profile of corpus) {
    for (const skill of profile.skills) {
      const key = normalizeSkill(skill.name);
      const entry = tally.get(key) ?? { raw: skill.name, ids: new Set<string>() };
      entry.ids.add(profile.id);
      tally.set(key, entry);
    }
  }
  return [...tally.values()]
    .filter((e) => e.ids.size >= 3 && e.ids.size <= corpus.length * 0.7)
    .sort((a, b) => b.ids.size - a.ids.size)
    .slice(0, count)
    .map((e) => e.raw);
}

/** Acronyms worth asking about: an institution with a short alias and few graduates. */
function acronymQuestions(corpus: CVProfile[]): EvalQuestion[] {
  const acronyms: Record<string, string> = {
    UPC: 'Universitat Politècnica de Catalunya',
    TCD: 'Trinity College Dublin',
    KTH: 'KTH Royal Institute of Technology',
    EPFL: 'École Polytechnique Fédérale de Lausanne',
    'IIT Bombay': 'Indian Institute of Technology Bombay',
    UPF: 'Universitat Pompeu Fabra',
  };

  return Object.entries(acronyms)
    .map(([acronym, full]) => ({ acronym, full, expected: withInstitution(corpus, full) }))
    .filter(({ expected }) => expected.length > 0 && expected.length <= 4)
    .slice(0, 3)
    .map(({ acronym, full, expected }) => ({
      id: `exact-${acronym.toLowerCase().replace(/\s+/g, '-')}`,
      question:
        expected.length === 1
          ? `Which candidate graduated from ${acronym}?`
          : `Which candidates graduated from ${acronym}?`,
      shape: 'exact-filter' as const,
      expected,
      note: `${acronym} never appears on a CV — only "${full}" does.`,
    }));
}

/** A (seniority, city, skill) triple that actually matches somebody. */
function multiConstraintQuestions(corpus: CVProfile[]): EvalQuestion[] {
  const out: EvalQuestion[] = [];
  const seniorities = ['senior', 'lead', 'principal'] as const;
  const cities = [...new Set(corpus.map(city))];
  const skills = informativeSkills(corpus, 12);

  for (const skill of skills) {
    for (const location of cities) {
      const expected = corpus
        .filter(
          (p) =>
            seniorities.includes(p.seniority as (typeof seniorities)[number]) &&
            city(p) === location &&
            p.skills.some((s) => normalizeSkill(s.name) === normalizeSkill(skill)),
        )
        .map((p) => p.id)
        .sort();
      if (expected.length >= 1 && expected.length <= 4) {
        out.push({
          id: `multi-${out.length + 1}`,
          question: `Which senior or above candidates are based in ${location} and know ${skill}?`,
          shape: 'multi-constraint',
          expected,
          note: 'Three constraints ANDed together — seniority, location, skill.',
        });
      }
      if (out.length === 2) return out;
    }
  }
  return out;
}

/** Questions with an empty correct answer. Hallucination shows up here. */
function negativeQuestions(corpus: CVProfile[]): EvalQuestion[] {
  const employers = new Set(corpus.flatMap((p) => p.experience.map((e) => e.company.toLowerCase())));
  const absent = ['Google', 'Meta', 'Amazon', 'Apple'].filter((c) => !employers.has(c.toLowerCase()));
  const questions: EvalQuestion[] = [];

  if (absent.length) {
    questions.push({
      id: 'negative-employer',
      question: `Which candidates worked at ${absent[0]}?`,
      shape: 'negative',
      expected: [],
      note: `Nobody in the corpus worked at ${absent[0]}. The right answer is to say so.`,
    });
  }

  const cobol = withSkill(corpus, 'COBOL');
  if (cobol.length === 0) {
    questions.push({
      id: 'negative-skill',
      question: 'Who has experience with COBOL?',
      shape: 'negative',
      expected: [],
      note: 'No candidate lists COBOL. Near-misses must not be offered as matches.',
    });
  }

  return questions;
}

export function buildQuestions(corpus: CVProfile[] = loadGroundTruth()): EvalQuestion[] {
  const questions: EvalQuestion[] = [];

  // 1. Aggregation — the shape top-k retrieval structurally cannot answer,
  //    because the correct answer is a complete set and k is a cap on it.
  const python = withSkill(corpus, 'Python');
  if (python.length) {
    questions.push({
      id: 'agg-python',
      question: 'Who has experience with Python?',
      shape: 'aggregation',
      expected: python,
      note: `${python.length} of ${corpus.length} candidates list Python. Classic top-5 can return at most 5.`,
    });
  }
  for (const skill of informativeSkills(corpus, 3)) {
    const expected = withSkill(corpus, skill);
    if (normalizeSkill(skill) === 'python' || expected.length === 0) continue;
    questions.push({
      id: `agg-${normalizeSkill(skill).replace(/[^a-z0-9]+/g, '-')}`,
      question: `Who has experience with ${skill}?`,
      shape: 'aggregation',
      expected,
      note: `${expected.length} candidates list ${skill}.`,
    });
  }

  const spanish = corpus.filter((p) => p.languages.some((l) => /spanish|español/i.test(l.language))).map((p) => p.id).sort();
  if (spanish.length) {
    questions.push({
      id: 'agg-spanish',
      question: 'How many candidates speak Spanish, and who are they?',
      shape: 'aggregation',
      expected: spanish,
      note: `${spanish.length} candidates. Asks for a count as well as the set.`,
    });
  }

  // 2. Exact / alias filter — the acronym questions.
  questions.push(...acronymQuestions(corpus));

  // 3. Whole-document fetch.
  for (const profile of [corpus[Math.floor(corpus.length / 3)], corpus[corpus.length - 2]].filter(Boolean)) {
    questions.push({
      id: `doc-${profile.id}`,
      question: `Summarize the profile of ${profile.name}.`,
      shape: 'document',
      expected: [profile.id],
      note: 'Needs the whole CV, not whichever chunks ranked highest.',
    });
  }

  // 4. Multi-constraint, and 5. negative cases.
  questions.push(...multiConstraintQuestions(corpus));
  questions.push(...negativeQuestions(corpus));

  return questions;
}

/* ---------------------------------------------------------------- scoring --- */

export interface Score {
  precision: number;
  recall: number;
  f1: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
}

/**
 * Set-based precision/recall over cited candidate ids.
 *
 * An empty expected set (the negative cases) is scored as: perfect only if
 * nothing was cited. Naming anyone at all is a precision of zero, which is the
 * behaviour we want to punish — a confident wrong name is worse than a miss.
 */
export function score(expected: string[], predicted: string[]): Score {
  const truth = new Set(expected);
  const guess = new Set(predicted);
  const truePositives = [...guess].filter((id) => truth.has(id)).length;
  const falsePositives = guess.size - truePositives;
  const falseNegatives = truth.size - truePositives;

  const precision = guess.size === 0 ? (truth.size === 0 ? 1 : 0) : truePositives / guess.size;
  const recall = truth.size === 0 ? (guess.size === 0 ? 1 : 0) : truePositives / truth.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return { precision, recall, f1, truePositives, falsePositives, falseNegatives };
}
