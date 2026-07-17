# ===== Stage 1: build backend (tsc) + frontend (vite) =====
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --no-audit --no-fund
COPY backend backend
COPY frontend frontend
RUN npm run build --workspace=backend && npm run build --workspace=frontend

# ===== Stage 2: runtime produksi =====
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist backend/public

# Direktori upload dokumen jamaah (mount volume di compose agar persisten)
RUN mkdir -p backend/uploads && chown -R node:node /app
USER node

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3001/v1/health || exit 1

# Migrasi dijalankan otomatis sebelum server start (idempoten)
CMD ["sh", "-c", "node backend/dist/db/scripts/migrate.js && node backend/dist/server.js"]
