# Infra — Calderdale Tennis League scraper on SAN

## First-time setup on the SAN

1. Copy `.env.example` to `.env` and set `POSTGRES_PASSWORD`.
2. `docker compose pull` to pull `postgres`, `ofelia`, and the scraper image from GHCR.
3. `docker compose up -d postgres ofelia` to start the long-running services.
4. One-off backfill of historical seasons:
   ```
   docker compose run --rm scraper pnpm --filter @ctl/scraper exec tsx src/index.ts --backfill
   ```
5. From now on ofelia will fire the scraper at Thursday 10:00 and Sunday 10:00 UK time.

## Manual scrape

```
docker compose run --rm scraper                              # current season
docker compose run --rm scraper pnpm ... -- --season=summer-2024
```

## Observability

```
docker compose exec postgres psql -U ctl -d ctl \
  -c "SELECT url, last_status, last_parse_ok, last_error FROM scrape_runs WHERE last_parse_ok = false"
```

Punch list of clubs awaiting review:

```
docker compose exec postgres psql -U ctl -d ctl \
  -c "SELECT id, slug, canonical_name FROM clubs WHERE needs_review = true"
```

## Updating the scraper

```
docker compose pull scraper
```

(Or run watchtower if you want auto-updates.)
