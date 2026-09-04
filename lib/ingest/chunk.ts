import { institutionSurfaceForms, skillSurfaceForms } from '../aliases';
import type { CVProfile } from '../schemas';
import type { ExtractedPdf } from './extract';

/**
 * Stage 4 of ingest (PRD §6.2).
 *
 * Chunk by semantic section, and split Work Experience per role. No fixed-size
 * sliding window: CVs already have the boundaries a window would have to guess at.
 *
 * Every chunk is prefixed with its identity before embedding. An anonymous chunk
 * reading "led the migration to Kubernetes" cannot be attributed, cannot be
 * cited, and — because thirty CVs in the same industry produce near-identical
 * prose — cannot be told apart from twenty-nine others in vector space.
 */

export type Section = 'Profile' | 'Skills' | 'Work Experience' | 'Education' | 'Languages';

export interface Chunk {
  chunk_id: string;
  candidate_id: string;
  candidate_name: string;
  section: Section;
  page: number;
  /** What gets embedded and shown as a citation snippet. */
  text: string;
}

/** Collapse for substring matching against extracted page text. */
function flatten(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Which page a chunk came from, so a citation can deep-link into the PDF.
 * Falls back to page 1, which is right for the single-page CVs in this corpus
 * and harmless for the rest.
 */
function locatePage(extracted: ExtractedPdf, needles: string[]): number {
  const pages = extracted.pages.map((p) => flatten(p.text));
  for (const needle of needles) {
    const probe = flatten(needle).slice(0, 60);
    if (probe.length < 8) continue;
    const index = pages.findIndex((page) => page.includes(probe));
    if (index >= 0) return extracted.pages[index].page;
  }
  return extracted.pages[0]?.page ?? 1;
}

function header(profile: CVProfile, section: Section): string {
  return `Candidate: ${profile.name} (${profile.id}) — Section: ${section}`;
}

export function chunkProfile(profile: CVProfile, extracted: ExtractedPdf): Chunk[] {
  const chunks: Chunk[] = [];
  const push = (section: Section, body: string, page: number, suffix: string) => {
    const text = `${header(profile, section)}\n${body}`.trim();
    chunks.push({
      chunk_id: `${profile.id}#${suffix}`,
      candidate_id: profile.id,
      candidate_name: profile.name,
      section,
      page,
      text,
    });
  };

  push(
    'Profile',
    [
      `${profile.name} — ${profile.current_title} (${profile.seniority}, ${profile.years_experience} years of experience).`,
      `Based in ${profile.location}. Contact: ${profile.email}, ${profile.phone}.`,
      profile.summary,
    ].join('\n'),
    locatePage(extracted, [profile.summary, profile.name]),
    'profile',
  );

  if (profile.skills.length) {
    // Alias surface forms ride along in the embedded text, so a vector query for
    // "k8s" still lands on a CV that only ever wrote "Kubernetes".
    const byCategory = new Map<string, string[]>();
    for (const skill of profile.skills) {
      const list = byCategory.get(skill.category) ?? [];
      list.push(skill.name);
      byCategory.set(skill.category, list);
    }
    const expansions = [
      ...new Set(profile.skills.flatMap((s) => skillSurfaceForms(s.name)).map((s) => s.trim())),
    ];
    push(
      'Skills',
      [
        `${profile.name} lists these skills:`,
        ...[...byCategory].map(([category, names]) => `${category}: ${names.join(', ')}`),
        `Also known as: ${expansions.join(', ')}.`,
      ].join('\n'),
      locatePage(extracted, [profile.skills[0].name]),
      'skills',
    );
  }

  profile.experience.forEach((role, i) => {
    push(
      'Work Experience',
      [
        `${role.title}, ${role.company} (${role.start_date} – ${role.end_date}).`,
        role.description,
      ].join('\n'),
      locatePage(extracted, [role.description, role.company]),
      `experience-${i}`,
    );
  });

  profile.education.forEach((entry, i) => {
    const forms = institutionSurfaceForms(entry.institution).filter((f) => f !== entry.institution);
    push(
      'Education',
      [
        `${entry.degree} in ${entry.field}, ${entry.institution}, graduated ${entry.end_year}.`,
        forms.length ? `${entry.institution} is also known as ${forms.join(', ')}.` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      locatePage(extracted, [entry.institution]),
      `education-${i}`,
    );
  });

  if (profile.languages.length) {
    push(
      'Languages',
      `${profile.name} speaks ${profile.languages.map((l) => `${l.language} (${l.level})`).join(', ')}.`,
      locatePage(extracted, [profile.languages[0]?.language ?? '']),
      'languages',
    );
  }

  return chunks;
}
