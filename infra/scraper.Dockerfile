# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY packages/domain/package.json packages/domain/
COPY packages/parser/package.json packages/parser/
COPY packages/db/package.json packages/db/
COPY packages/data/package.json packages/data/
COPY apps/scraper/package.json apps/scraper/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY apps/scraper apps/scraper
# No build step needed — we run with tsx in the final image.

FROM base AS runtime
COPY --from=build /app /app
WORKDIR /app
ENV NODE_ENV=production
# Migrate then scrape — both idempotent.
CMD ["sh", "-c", "pnpm --filter @ctl/db db:migrate && pnpm --filter @ctl/scraper exec tsx src/index.ts"]
