/**
 * Deterministic job parser — LLM-free fallback.
 *
 * Extracts title/company/location heuristically and detects skills by
 * matching a curated keyword list against the raw text. Guarantees the
 * product works end-to-end with MOCK_LLM=true or a failed LLM call.
 */

const SKILL_KEYWORDS = [
  'python', 'typescript', 'javascript', 'java', 'c++', 'c#', 'go', 'rust', 'sql',
  'react', 'node', 'django', 'flask', 'fastapi', 'spring', 'express', 'next.js',
  'postgresql', 'mysql', 'mongodb', 'redis', 'docker', 'kubernetes', 'terraform',
  'aws', 'azure', 'gcp', 'rest', 'graphql', 'grpc', 'ci/cd', 'linux', 'git',
  'machine learning', 'deep learning', 'nlp', 'llm', 'pytorch', 'tensorflow',
  'pandas', 'numpy', 'airflow', 'spark', 'kafka', 'prisma', 'vitest', 'pytest',
];

const IMPORTANCE_HINTS: Array<[RegExp, number]> = [
  [/\b(required|must have|must-have|strong)\b/i, 0.9],
  [/\b(proven|solid|experience with|proficiency)\b/i, 0.7],
  [/\b(nice to have|plus|bonus|preferred|familiarity)\b/i, 0.3],
];

export interface ParsedJobFallback {
  title: string;
  company: string;
  location: string;
  summary: string;
  requirements: Array<{ skill: string; importance: number; category: string }>;
}

export function parseJobDeterministic(rawText: string): ParsedJobFallback {
  const firstLines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
  const title = firstLines[0]?.slice(0, 200) ?? 'Untitled role';
  const company = firstLines[1]?.slice(0, 120) ?? 'Unknown company';
  const location = (rawText.match(/(remote|hybrid|bengaluru|bangalore|hyderabad|pune|delhi|mumbai)/i)?.[1] ?? '').slice(0, 120);

  const requirements: ParsedJobFallback['requirements'] = [];
  // Sentence-level context: importance hints must come from the sentence
  // mentioning the skill, never bleed across neighbouring requirements.
  const sentences = rawText.split(/(?<=[.!?;])\s+|\n+/).filter((s) => s.trim().length > 0);
  for (const skill of SKILL_KEYWORDS) {
    const re = new RegExp(`(^|[^a-z0-9+#])${escapeRegExp(skill)}([^a-z0-9+#]|$)`, 'i');
    if (!re.test(rawText)) continue;
    const sentence = sentences.find((s) => re.test(s));
    let importance = 0.5;
    for (const [pattern, weight] of IMPORTANCE_HINTS) {
      if (sentence !== undefined && pattern.test(sentence)) {
        importance = weight;
        break;
      }
    }
    requirements.push({ skill, importance, category: 'general' });
  }

  return {
    title,
    company,
    location,
    summary: firstLines.slice(0, 3).join(' ').slice(0, 400),
    requirements: requirements.slice(0, 15),
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
