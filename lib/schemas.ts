import { z } from 'zod';

/**
 * The single source of truth for a candidate.
 *
 * The same schema is used three times, which is the point:
 *   1. generation — structured output constraint when the LLM writes a CV
 *   2. ingest     — structured output constraint when the LLM reads a PDF back
 *   3. eval       — the ground-truth oracle we score retrieval against
 *
 * Because (1) and (2) share a schema, the round-trip is directly diffable.
 */
export const SkillSchema = z.object({
  name: z.string().describe('Skill as written on the CV, e.g. "PostgreSQL"'),
  category: z
    .string()
    .describe('Grouping, e.g. "Languages", "Frameworks", "Data", "Cloud", "Tools", "Design", "Product"'),
});

export const ExperienceSchema = z.object({
  company: z.string(),
  title: z.string(),
  start_date: z.string().describe('"YYYY-MM" or "YYYY"'),
  end_date: z.string().describe('"YYYY-MM", "YYYY", or "Present"'),
  description: z
    .string()
    .describe('2–4 sentences. Concrete systems, technologies and quantified outcomes.'),
});

export const EducationSchema = z.object({
  institution: z.string().describe('Full official name, never the acronym'),
  degree: z.string().describe('e.g. "BSc", "MSc", "PhD"'),
  field: z.string(),
  end_year: z.number().int(),
});

export const LanguageSchema = z.object({
  language: z.string(),
  level: z.string().describe('e.g. "Native", "Fluent", "C1", "B2", "Conversational"'),
});

export const CVProfileSchema = z.object({
  id: z.string().describe('Stable candidate id, e.g. "cv_017"'),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  location: z.string().describe('"City, Country"'),
  current_title: z.string(),
  seniority: z.enum(['junior', 'mid', 'senior', 'lead', 'principal']),
  years_experience: z.number(),
  summary: z.string().describe('2–3 sentence professional summary, first person avoided'),
  skills: z.array(SkillSchema),
  experience: z.array(ExperienceSchema),
  education: z.array(EducationSchema),
  languages: z.array(LanguageSchema),
});

export type CVProfile = z.infer<typeof CVProfileSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type Experience = z.infer<typeof ExperienceSchema>;
export type Education = z.infer<typeof EducationSchema>;
export type CVLanguage = z.infer<typeof LanguageSchema>;

/**
 * The generation-time variant: the id is assigned by the sampler, not the model,
 * so we strip it from what the model is asked to produce.
 */
export const GeneratedCVSchema = CVProfileSchema.omit({ id: true });
export type GeneratedCV = z.infer<typeof GeneratedCVSchema>;

/** Every tool result carries enough to render a citation. */
export interface CitationRef {
  candidate_id: string;
  name: string;
  current_title: string;
  pdf_path: string;
  page: number;
}

export interface ChunkHit extends CitationRef {
  chunk_id: string;
  section: string;
  text: string;
  score: number;
}

export interface CandidateRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  location: string;
  current_title: string;
  seniority: string;
  years_experience: number;
  summary: string;
  photo_path: string;
  pdf_path: string;
  num_pages: number;
}

export type ChatMode = 'agentic' | 'classic';
