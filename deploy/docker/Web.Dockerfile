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
COPY scripts/Verify-WebArtifact.cjs scripts/Verify-WebArtifact.cjs
ARG APP=owner-web
ARG VITE_API_BASE_URL
ARG VITE_DEPLOYMENT_ENVIRONMENT
ARG BHOME_REVISION
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_DEPLOYMENT_ENVIRONMENT=$VITE_DEPLOYMENT_ENVIRONMENT
ENV VITE_API_MODE=api
RUN test "$APP" = "owner-web" -o "$APP" = "public-web" \
    && test -n "$VITE_API_BASE_URL" \
    && test -n "$VITE_DEPLOYMENT_ENVIRONMENT" \
    && npm run build --workspace ./src/$APP \
    && node scripts/Verify-WebArtifact.cjs src/$APP/dist "$VITE_DEPLOYMENT_ENVIRONMENT" "$VITE_API_BASE_URL" "$APP" "$BHOME_REVISION" \
    && cp -r src/$APP/dist /web

FROM nginxinc/nginx-unprivileged:stable-alpine
COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web/ /usr/share/nginx/html/
EXPOSE 8080
