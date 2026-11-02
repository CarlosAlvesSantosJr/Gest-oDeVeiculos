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
ENV PORT=3002 DB_PATH=/data/notificacoes.db
VOLUME /data
EXPOSE 3002
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3002/health || exit 1
CMD ["node", "src/server.js"]
