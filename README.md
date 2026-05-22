# Calderdale Tennis League — modern frontend

A re-imagined, personalised public-view frontend for [calderdale.tennis-league.org](https://www.calderdale.tennis-league.org/), built as a static-first PWA.

> Not affiliated with the Calderdale Tennis League. Data is sourced from their public site by polite scheduled scraping.

## Status

Phase 1 (parser + domain) and Phase 2 (scraper + data layer + Docker-on-SAN deployment) complete. Twice-weekly scrape (Thu 10:00 + Sun 10:00 UK) runs on the SAN via ofelia.

See `docs/superpowers/specs/2026-05-17-phase-2-scraper-and-data-layer.md` for design, `docs/superpowers/plans/2026-05-17-phase-2-scraper-and-data-layer.md` for the implementation plan, and `infra/README.md` for operations.

Phase 4 (web frontend) is the next planned phase.

## Project shape

```mermaid
flowchart LR
  Upstream[(calderdale.tennis-league.org)]
  Scraper -- HTML --> Upstream
  Scraper -- JSON --> R2[(R2 snapshots)]
  Web[Next.js · Cloudflare Pages] --> R2
  Web -- live --> LiveAPI[Cloudflare Worker]
  LiveAPI -- HTML --> Upstream
```

## Repo layout

```
packages/domain        Zod schemas + TS types
packages/parser        HTML → domain objects (pure functions)
packages/db            Drizzle schema + migrations
packages/data          Typed read functions on top of @ctl/db
apps/parse-cli         Phase 1 CLI: fetch any supported URL, print JSON
apps/scraper           Phase 2 scraper: walks upstream, writes to DB
infra/                 Docker compose for SAN deployment
fixtures/              Captured HTML for parser tests
docs/superpowers/      Specs and implementation plans
```

## Quickstart (dev)

```bash
pnpm install
pnpm db:dev                                          # local postgres in docker
pnpm db:migrate                                      # apply migrations
pnpm test                                            # run all tests (uses Testcontainers — Docker required)
pnpm parse "<url>"                                   # one-off page parse
DATABASE_URL=postgres://ctl:ctl@localhost:5433/ctl pnpm scrape   # run scraper against dev DB
pnpm db:dev:stop
```

See `apps/parse-cli/README.md` for example URLs.

## Operations (SAN)

See `infra/README.md`.
