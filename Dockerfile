# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
# prisma.config.ts resolves both URLs even for generate; any values will do at build time
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build SHADOW_DATABASE_URL=postgresql://build:build@localhost:5432/build_shadow pnpm prisma:generate && pnpm build

FROM build AS pruned
RUN pnpm prune --prod

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=pruned /app/node_modules ./node_modules
COPY --from=pruned /app/dist ./dist
COPY --from=pruned /app/package.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
