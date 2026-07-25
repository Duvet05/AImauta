# syntax=docker/dockerfile:1.7

FROM node:22.23.0-bookworm-slim@sha256:dc73bdac873c82e6cbfa496e35dd6e27a20302ebba043d0d9646708df19a9996 AS node-base

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

FROM node-base AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

FROM dependencies AS migrator
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
USER node
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

FROM dependencies AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

FROM node-base AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=127.0.0.1 \
    PORT=3309

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node
EXPOSE 3309

CMD ["node", "server.js"]
