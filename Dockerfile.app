FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json dprint.json setupTests.ts vitest.config.ts vitest.shared.ts ./
COPY knowledge ./knowledge
COPY patches ./patches
COPY scripts ./scripts
COPY packages ./packages

RUN pnpm install --frozen-lockfile
