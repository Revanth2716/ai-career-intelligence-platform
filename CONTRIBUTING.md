# Contributing

Thanks for considering a contribution! This project is a compact, production-style
reference application — keep changes focused and match the existing architecture.

## Development setup

```bash
pnpm install
cp .env.example .env
cp .env apps/server/.env
docker compose up -d db
pnpm db:migrate
pnpm seed
pnpm dev
```

`MOCK_LLM=true` (the default) keeps everything offline and free — please keep it that
way in committed configuration and tests.

## Ground rules

- **Never commit secrets or personal data**: no `.env` files, API keys, passwords,
  JWT secrets, uploaded resumes, logs, or private user folders (`job-skill/` is
  git-ignored). Seed data in `db/seed` must stay synthetic.
- **Preserve the mock provider path**: features must work with `MOCK_LLM=true`;
  add mock scenarios rather than requiring live API calls in tests.
- **Keep the deterministic-first design**: scores/coverage are computed in code; the
  LLM only explains. New AI features need a fallback for when no key is configured.
- **Schema changes**: edit `apps/server/prisma/schema.prisma` and generate a migration
  (`pnpm --filter @career/server exec prisma migrate dev --name your_change`); never
  edit applied migration files.
- **Shared contracts**: API shapes belong in `packages/shared` (zod schemas) so client
  and server validate the same contracts.

## Quality gates (CI runs all of these)

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration   # needs the compose Postgres running
pnpm build
```

Please make sure all five pass before opening a pull request.

## Commit style

Conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`),
short imperative subject, details in the body when useful.

## Reporting issues

Include: what you did, what you expected, what happened, and environment details
(OS, Node version, Docker). For security issues, see the notes in the README and
open a private security advisory rather than a public issue.
