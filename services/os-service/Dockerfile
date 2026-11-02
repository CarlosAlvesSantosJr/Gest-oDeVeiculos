FROM node:24-alpine AS base
WORKDIR /app
ENV NODE_ENV=production \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning
COPY package*.json ./

# Estágio de testes: docker build --target test .
FROM base AS test
RUN npm ci
COPY . .
RUN npm test

FROM base AS runtime
RUN npm ci --omit=dev && npm cache clean --force \
    && mkdir -p /data && chown node:node /data
COPY src ./src
USER node
ENV PORT=3001 DB_PATH=/data/oficina.db
EXPOSE 3001
VOLUME /data
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1
CMD ["node", "src/server.js"]
