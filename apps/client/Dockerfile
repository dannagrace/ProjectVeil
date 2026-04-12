FROM node:22-bookworm-slim AS build
WORKDIR /app

ENV npm_config_update_notifier=false

COPY package.json package-lock.json ./
COPY apps/client/package.json ./apps/client/package.json
COPY apps/cocos-client/package.json ./apps/cocos-client/package.json
COPY packages/cc-runtime-stub/package.json ./packages/cc-runtime-stub/package.json

RUN npm ci --no-audit --no-fund

COPY . .

RUN npm run build:client:h5

FROM nginx:1.27-alpine
COPY apps/client/nginx.prod.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/client/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
