FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependency layer first: source edits must not bust the install cache.
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --prod --frozen-lockfile

COPY src ./src

USER node
EXPOSE 4000

CMD ["node", "src/index.js"]