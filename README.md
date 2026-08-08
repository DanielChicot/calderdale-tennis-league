# Calderdale Tennis League — modern frontend

A re-imagined public-view frontend for [calderdale.tennis-league.org](https://www.calderdale.tennis-league.org/): a SvelteKit viewer over a Postgres database populated by polite scheduled scraping.

> Not affiliated with the Calderdale Tennis League. Data is sourced from their public site by polite scheduled scraping.

## Status

- **Phase 1** — parser + domain: complete.
- **Phase 2** — scraper + data layer: complete. Twice-weekly scrape (Thu 10:00 + Sun 10:00 UK) runs on the SAN via ofelia (`infra/docker-compose.yml`).
- **Web viewer** — complete: SvelteKit app (`apps/web`) with a dark "data terminal" theme — standings, fixtures & results, match cards, player rankings, clubs and players.
- **Render deployment** — blueprint ready (`render.yaml`): an independent stack (own managed Postgres + web service + cron scraper), not yet instantiated.

See `docs/superpowers/specs/` and `docs/superpowers/plans/` for design history, and `infra/README.md` for SAN operations.

## Project shape

```mermaid
flowchart LR
  Upstream[(calderdale.tennis-league.org)]
  Scraper -- polite HTML fetch --> Upstream
  Scraper -- Drizzle upserts --> DB[(Postgres)]
  Web[SvelteKit · adapter-node] -- "@ctl/data reads" --> DB
```

The scraper walks the upstream site (seasons → divisions → teams → fixtures → match cards → rankings → contacts) and upserts idempotently into Postgres. The web app server-renders straight from the database — no live calls to the upstream site.

## Repo layout

```
packages/domain        Zod schemas + TS types
packages/parser        HTML → domain objects (pure functions)
packages/db            Drizzle schema + migrations
packages/data          Typed read functions on top of @ctl/db
apps/parse-cli         Phase 1 CLI: fetch any supported URL, print JSON
apps/scraper           Phase 2 scraper: walks upstream, writes to DB
apps/web               SvelteKit viewer (adapter-node, dark data-terminal theme)
infra/                 Docker compose for SAN deployment + Render ad-hoc scrape script
render.yaml            Render Blueprint: web service + managed Postgres + cron scraper
fixtures/              Captured HTML for parser tests
docs/superpowers/      Specs and implementation plans
```

## Quickstart (dev)

```bash
pnpm install
pnpm db:dev                                          # local postgres in docker (port 5433)
pnpm db:migrate                                      # apply migrations
pnpm test                                            # run all tests (uses Testcontainers — Docker required)
pnpm parse "<url>"                                   # one-off page parse
DATABASE_URL=postgres://ctl:ctl@localhost:5433/ctl pnpm scrape   # run scraper against dev DB
DATABASE_URL=postgres://ctl:ctl@localhost:5433/ctl pnpm --filter @ctl/web dev   # web viewer on :5173
pnpm db:dev:stop
```

See `apps/parse-cli/README.md` for example URLs.

## Deployment

- **SAN** (live): scraper stack only — Postgres + ofelia cron + scraper container. See `infra/README.md`.
- **Render** (ready, not instantiated): `render.yaml` provisions a fully independent stack — managed Postgres, the web service (migrations run per-deploy), and a Thu/Sun cron scraper. Ad-hoc scrapes (backfill / specific season) run as Render one-off jobs via `infra/render-adhoc-scrape.sh`.
