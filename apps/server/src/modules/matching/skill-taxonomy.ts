/**
 * Canonical skill taxonomy + alias normalisation.
 *
 * A plain Map lookup (O(1)) is the right structure here; a trie would only
 * pay off at much larger N (documented in docs/DECISIONS.md).
 */
const SKILL_ALIASES = new Map<string, string>(
  [
    ['js', 'javascript'],
    ['nodejs', 'node'],
    ['node.js', 'node'],
    ['ts', 'typescript'],
    ['postgres', 'postgresql'],
    ['postgresdb', 'postgresql'],
    ['psql', 'postgresql'],
    ['k8s', 'kubernetes'],
    ['ml', 'machine learning'],
    ['llms', 'llm'],
    ['rest api', 'rest'],
    ['restful', 'rest'],
    ['reactjs', 'react'],
    ['react.js', 'react'],
    ['fast api', 'fastapi'],
    ['py', 'python'],
    ['c++', 'cpp'],
    ['c#', 'csharp'],
    ['dotnet', 'csharp'],
    ['.net', 'csharp'],
    ['aws cloud', 'aws'],
    ['gcp', 'google cloud'],
    ['docker compose', 'docker'],
    ['containerization', 'docker'],
    ['unit testing', 'testing'],
    ['automated testing', 'testing'],
    ['pytest', 'testing'],
    ['vitest', 'testing'],
    ['jest', 'testing'],
    ['supertest', 'testing'],
    ['gorm', 'orm'],
    ['sqlalchemy', 'orm'],
    ['prisma', 'orm'],
  ] as const,
);

export function normalizeSkill(skill: string): string {
  const cleaned = skill.toLowerCase().trim().replace(/\s+/g, ' ');
  return SKILL_ALIASES.get(cleaned) ?? cleaned;
}

export function normalizeSkillList(skills: string[]): string[] {
  return [...new Set(skills.map(normalizeSkill).filter((s) => s.length > 1))];
}
