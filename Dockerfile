FROM node:22.12.0-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml vite.config.ts tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/website/package.json apps/website/package.json
COPY packages/utils/package.json packages/utils/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm exec vp run -r build

FROM node:22.12.0-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
ENV DATABASE_URL=/data/onlywrite.sqlite
ENV WEBSITE_DIST=/app/apps/website/dist
RUN corepack enable
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/website/package.json apps/website/package.json
COPY --from=build /app/packages/utils/package.json packages/utils/package.json
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api apps/api
COPY --from=build /app/apps/website/dist apps/website/dist
EXPOSE 8787
VOLUME ["/data", "/backups"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--dir", "apps/api", "exec", "tsx", "src/server.ts"]
