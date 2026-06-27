#!/usr/bin/env bash
#
# Trigger an ad-hoc scrape as a Render one-off job against the ctl-scraper service,
# using the Render CLI (https://render.com/docs/cli). Run `render login` once first.
#
# The job reuses ctl-scraper's latest build artifact and environment (including
# DATABASE_URL), so it writes to the same Render Postgres the cron job does — the
# CLI-free equivalent is `POST /v1/services/<srv>/jobs` (see render.yaml).
#
# Render serialises a cron job's *scheduled* runs, but a one-off job is a separate
# resource — avoid launching a long backfill near the Thu/Sun 09:00 UTC slots so
# two writers don't hit the DB at once.
#
# Required env:
#   RENDER_SCRAPER_SERVICE_ID   The ctl-scraper service id (srv-...), from its dashboard URL
#
# Usage (after `render login`):
#   RENDER_SCRAPER_SERVICE_ID=srv-… ./infra/render-adhoc-scrape.sh                 # current season
#   RENDER_SCRAPER_SERVICE_ID=srv-… ./infra/render-adhoc-scrape.sh --backfill
#   RENDER_SCRAPER_SERVICE_ID=srv-… ./infra/render-adhoc-scrape.sh --season=summer-2024
#
set -euo pipefail

: "${RENDER_SCRAPER_SERVICE_ID:?set RENDER_SCRAPER_SERVICE_ID (srv-...) — see the ctl-scraper dashboard URL}"

# Forward any args (--backfill, --season=…) straight to the scraper CLI.
scraper_args="$*"
start_command="pnpm --filter @ctl/db db:migrate && pnpm --filter @ctl/scraper exec tsx src/index.ts ${scraper_args}"

echo "→ launching one-off job on ${RENDER_SCRAPER_SERVICE_ID}: ${start_command}"
render jobs create "${RENDER_SCRAPER_SERVICE_ID}" \
  --start-command "${start_command}" \
  --confirm --output text
