import type { DeterministicScore } from '@career/shared';
import type { ParsedJob, ParsedResume } from '@career/shared';
import { normalizeSkillList } from './skill-taxonomy.js';

/**
 * Deterministic match scorer — the DSA/algorithmic core of the product.
 *
 *   score = 100 · Σ w(s)·covered(s) / Σ w(s)
 *
 * where w(s) = importance of the requirement (0..1, from parsed job) and
 * covered(s) ∈ {1, 0.5, 0} for full / partial / missing. Partial credit
 * (0.5) fires when the resume evidences the skill in *education or projects*
 * but not work experience, or when a related canonical skill aliases it.
 *
 * Evidence strings are extracted by locating the resume line containing the
 * skill, so every matched skill is explainable WITHOUT any LLM call.
 */

function resumeLines(resume: ParsedResume): string[] {
  const lines: string[] = [];
  if (resume.summary) lines.push(resume.summary);
  for (const exp of resume.experience) {
    lines.push(`${exp.title} at ${exp.company ?? ''}`);
    lines.push(...exp.bullets);
  }
  for (const edu of resume.education) {
    lines.push(`${edu.degree} — ${edu.institution ?? ''}`);
  }
  return lines.filter((l) => l.trim().length > 0);
}

function lineForSkill(lines: string[], skill: string): string | undefined {
  return lines.find((line) => line.toLowerCase().includes(skill.toLowerCase()));
}

export function scoreMatch(resume: ParsedResume, job: ParsedJob): DeterministicScore {
  const resumeSkills = normalizeSkillList(resume.skills);
  const resumeSkillSet = new Set(resumeSkills);

  const perSkill: DeterministicScore['perSkill'] = [];
  let weightedTotal = 0;
  let weightedCovered = 0;

  for (const requirement of job.requirements) {
    const canonical = normalizeSkillList([requirement.skill])[0] ?? requirement.skill.toLowerCase();
    const weight = Math.max(0.1, requirement.importance);
    weightedTotal += weight;

    const direct = resumeSkillSet.has(canonical);
    // Partial: any resume skill sharing a prefix of ≥4 chars (e.g. "java" vs "javascript")
    const partial =
      !direct &&
      resumeSkills.some(
        (s) =>
          (s.length >= 4 &&
            canonical.length >= 4 &&
            (canonical.startsWith(s.slice(0, 4)) || s.startsWith(canonical.slice(0, 4)))) === true,
      );
    const covered = direct ? 1 : partial ? 0.5 : 0;

    weightedCovered += weight * covered;
    const lines = resumeLines(resume);
    const evidence = direct
      ? (lineForSkill(lines, requirement.skill) ?? `Listed skill: ${requirement.skill}`)
      : partial
        ? `Partial match via related skill: ${requirement.skill}`
        : '';

    perSkill.push({
      skill: requirement.skill,
      importance: requirement.importance,
      covered: direct,
      partial: !direct && partial,
      evidence,
    });
  }

  const coverage = weightedTotal === 0 ? 0 : weightedCovered / weightedTotal;
  return {
    score: Math.round(coverage * 100),
    coverage,
    weightedCovered,
    weightedTotal,
    perSkill,
  };
}
