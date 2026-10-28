FROM node:22-alpine AS build
WORKDIR /source
COPY package.json package-lock.json ./
COPY packages/ packages/
COPY src/owner-web/package.json src/owner-web/package.json
COPY src/public-web/package.json src/public-web/package.json
COPY src/mobile/package.json src/mobile/package.json
RUN npm ci --no-fund --no-audit
COPY tsconfig.base.json ./
COPY src/ src/
COPY tests/ tests/
ARG APP=owner-web
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN test "$APP" = "owner-web" -o "$APP" = "public-web" \
    && test -n "$VITE_API_BASE_URL" \
    && npm run build --workspace @bhome/$APP \
    && cp -r src/$APP/dist /web

FROM nginxinc/nginx-unprivileged:stable-alpine
COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web/ /usr/share/nginx/html/
EXPOSE 8080
