import { normalizeInstitution, normalizeSkill } from '../aliases';
import type { CVProfile } from '../schemas';

/**
 * Stage 3 of ingest (PRD §6.1).
 *
 * Every filterable string is stored twice: the raw form the candidate wrote, and
 * an alias-collapsed form. `filter_candidates` matches on the collapsed column
 * and displays the raw one, which is the entire reason "UPC" finds a candidate
 * whose CV says "Universitat Politècnica de Catalunya".
 */

export interface NormalizedSkill {
  candidate_id: string;
  skill: string;
  skill_norm: string;
  category: string;
}

export interface NormalizedEducation {
  candidate_id: string;
  institution: string;
  institution_norm: string;
  degree: string;
  field: string;
  end_year: number;
}

export interface NormalizedProfile {
  profile: CVProfile;
  skills: NormalizedSkill[];
  education: NormalizedEducation[];
}

export function normalizeProfile(profile: CVProfile): NormalizedProfile {
  const seen = new Set<string>();
  const skills: NormalizedSkill[] = [];
  for (const skill of profile.skills) {
    const skill_norm = normalizeSkill(skill.name);
    if (!skill_norm || seen.has(skill_norm)) continue;
    seen.add(skill_norm);
    skills.push({
      candidate_id: profile.id,
      skill: skill.name.trim(),
      skill_norm,
      category: skill.category?.trim() || 'Other',
    });
  }

  const education = profile.education.map((entry) => ({
    candidate_id: profile.id,
    institution: entry.institution.trim(),
    institution_norm: normalizeInstitution(entry.institution),
    degree: entry.degree?.trim() ?? '',
    field: entry.field?.trim() ?? '',
    end_year: entry.end_year,
  }));

  return { profile, skills, education };
}
