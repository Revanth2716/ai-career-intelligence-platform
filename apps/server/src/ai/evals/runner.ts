import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { scoreMatch } from '../../modules/matching/scorer.js';
import { parseJobDeterministic } from '../../services/job-parser.service.js';
import { normalizeSkillList } from '../../modules/matching/skill-taxonomy.js';
import { features } from '../../config/env.js';
import type { ParsedResume, ParsedJob } from '@career/shared';

/**
 * AI evaluation runner.
 *
 * Metrics:
 *  - parse cases: skill precision/recall/F1 vs expectSkills
 *  - match cases: deterministic score must land in expectedScoreBand
 *
 * With MOCK_LLM=true the deterministic parser is what gets graded (the LLM
 * path is unavailable); with a real key the LLM pipeline is graded. CI runs
 * this opt-in (OPENAI_API_KEY secret) and fails on threshold regression.
 */

interface MatchCase {
  name: string;
  resume: ParsedResume;
  job: { title: string; company: string; location: string; summary: string; requirements: Array<{ skill: string; importance: number }> };
  expectedScoreBand: [number, number];
}

interface ParseCase {
  name: string;
  text: string;
  expectSkills: string[];
  minF1: number;
}

interface EvalFile {
  matchCases: MatchCase[];
  parseCases: ParseCase[];
}

function f1(predicted: string[], expected: string[]): number {
  const p = new Set(predicted.map((s) => s.toLowerCase()));
  const e = new Set(expected.map((s) => s.toLowerCase()));
  if (e.size === 0) return 1;
  let tp = 0;
  for (const s of e) if (p.has(s)) tp += 1;
  const precision = p.size === 0 ? 0 : tp / p.size;
  const recall = tp / e.size;
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const doc = yaml.parse(fs.readFileSync(path.join(here, 'cases.yaml'), 'utf8')) as EvalFile;

  let failures = 0;
  const rows: string[] = [];

  // ── Match (deterministic scorer — always graded) ──
  for (const c of doc.matchCases ?? []) {
    const result = scoreMatch(c.resume, c.job as ParsedJob);
    const [lo, hi] = c.expectedScoreBand;
    const ok = result.score >= lo && result.score <= hi;
    if (!ok) failures += 1;
    rows.push(`${ok ? 'PASS' : 'FAIL'} match  ${c.name.padEnd(28)} score=${result.score} band=[${lo},${hi}]`);
  }

  // ── Parse (deterministic fallback; LLM when configured) ──
  for (const c of doc.parseCases ?? []) {
    let skills: string[];
    if (features.useRealLlm) {
      const { parseJobWithLlm } = await import('../pipelines/parse-job.js');
      const parsed = await parseJobWithLlm(c.text);
      skills = parsed.requirements.map((r) => r.skill);
    } else {
      skills = parseJobDeterministic(c.text).requirements.map((r) => r.skill);
    }
    const score = f1(normalizeSkillList(skills), c.expectSkills);
    const ok = score >= c.minF1;
    if (!ok) failures += 1;
    rows.push(`${ok ? 'PASS' : 'FAIL'} parse  ${c.name.padEnd(28)} F1=${score.toFixed(2)} min=${c.minF1}`);
  }

  console.log('\n=== AI evals ===');
  for (const r of rows) console.log(r);
  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`} (provider: ${features.useRealLlm ? 'LLM' : 'deterministic/mock'})\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
