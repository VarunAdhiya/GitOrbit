FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/matching/package.json packages/matching/package.json
RUN npm ci
COPY . .
RUN npm run db:generate

FROM base AS services
ENV NODE_ENV=production
USER node
CMD ["npm", "run", "start:api"]

FROM base AS web-build
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @gitorbit/web

FROM web-build AS web
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["npm", "run", "start:web"]
