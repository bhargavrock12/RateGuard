FROM node:20-alpine

# Smallest correction for implementation drift (Prisma needs OpenSSL on Alpine)
RUN apk add --no-cache openssl

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --include=dev && npm prune --omit=dev

COPY src ./src

USER node
EXPOSE 4001

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:4001/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/index.js"]