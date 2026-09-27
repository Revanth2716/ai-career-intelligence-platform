# Multi-stage build: install -> build -> static files served by nginx (with /api proxy)
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/client/package.json apps/client/
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY apps/client apps/client
RUN pnpm --filter @career/shared build && pnpm --filter @career/client build

FROM nginx:1.27-alpine
COPY docker/client.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/client/dist /usr/share/nginx/html
EXPOSE 80
