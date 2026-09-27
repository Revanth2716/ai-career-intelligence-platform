/**
 * Seed: imports the user's real job-search data from the job-skill/ folder
 * (read-only) into a demo account, so the app is immediately explorable.
 * Run: pnpm seed
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

interface TrackerRow {
  Date_Found?: string;
  Company?: string;
  Role?: string;
  Platform?: string;
  Location?: string;
  'Job URL'?: string;
  'Fitness Score'?: string;
  Status?: string;
  Notes?: string;
}

function parseCsv(csv: string): TrackerRow[] {
  const lines = csv.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0] ?? '');
  return lines.slice(1).map((line) => {
    const values = mergeUnbalancedFields(splitCsvLine(line));
    const row: TrackerRow = {};
    headers.forEach((h, i) => {
      const key = h as keyof TrackerRow;
      const value = values[i];
      if (key !== undefined && value !== undefined) (row as Record<string, string>)[key] = value;
    });
    return row;
  });
}

/**
 * The tracker CSV contains unquoted embedded commas inside parentheses
 * (e.g. `F5 (F5, Inc.)`), which split into extra fields. Merge a field whose
 * parentheses don't balance with its successor until they do.
 */
function mergeUnbalancedFields(fields: string[]): string[] {
  const out: string[] = [];
  for (const field of fields) {
    const prev = out[out.length - 1];
    if (prev !== undefined && unbalancedOpen(prev)) {
      out[out.length - 1] = `${prev},${field}`;
    } else {
      out.push(field);
    }
  }
  return out;
}

function unbalancedOpen(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
  }
  return depth > 0;
}

/** Minimal CSV splitter handling quotes and escaped quotes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function main(): Promise<void> {
  const email = 'demo@career.local';
  const password = 'Demo1234!x';

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: 'Demo User',
      role: 'ADMIN',
      passwordHash: bcrypt.hashSync(password, 12),
    },
  });

  // Seed data lives in db/seed (synthetic demo files, safe to publish).
  // JOB_SKILL_DIR may point at a private local folder to seed real data;
  // it is never committed. Empty string => bundled default.
  const configuredDir = process.env['JOB_SKILL_DIR'] ?? '';
  const seedDir = path.resolve(configuredDir.length > 0 ? configuredDir : path.join('..', '..', 'db', 'seed'));

  // ── Resume from demo profile ──
  const profilePath = path.join(seedDir, 'demo-profile.md');
  if (fs.existsSync(profilePath)) {
    const profileText = fs.readFileSync(profilePath, 'utf8');
    const existing = await prisma.resume.findFirst({ where: { userId: user.id, title: 'Demo Candidate — Master Resume' } });
    if (existing === null) {
      await prisma.resume.create({
        data: {
          userId: user.id,
          title: 'Demo Candidate — Master Resume',
          fileName: '',
          mimeType: 'text/markdown',
          sizeBytes: Buffer.byteLength(profileText),
          rawText: profileText,
          status: 'PENDING',
        },
      });
      console.log('Seeded resume from demo-profile.md');
    }
  }

  // ── Jobs from demo tracker ──
  const trackerPath = path.join(seedDir, 'demo-jobs.csv');
  if (fs.existsSync(trackerPath)) {
    const csv = fs.readFileSync(trackerPath, 'utf8');
    const rows = parseCsv(csv);
    for (const row of rows) {
      const url = row['Job URL'] || undefined;
      const existing = url !== undefined
        ? await prisma.job.findFirst({ where: { userId: user.id, url } })
        : await prisma.job.findFirst({ where: { userId: user.id, title: row['Role'] ?? '', company: row['Company'] ?? '' } });
      if (existing !== null) continue;

      const job = await prisma.job.create({
        data: {
          userId: user.id,
          title: row['Role'] ?? 'Untitled role',
          company: row['Company'] ?? 'Unknown company',
          location: row['Location'] ?? '',
          url,
          source: 'SEED',
          rawText: [
            `${row['Role'] ?? 'Role'} at ${row['Company'] ?? 'Company'} (${row['Location'] ?? ''}).`,
            `Platform: ${row['Platform'] ?? ''}. Found: ${row['Date_Found'] ?? ''}.`,
            `Notes: ${row['Notes'] ?? ''}`,
          ].join('\n'),
          status: 'PENDING',
        },
      });
      console.log(`Seeded job: ${job.title} @ ${job.company}`);
    }
  }

  console.log(`Seed complete. Demo login: ${email} / ${password}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
