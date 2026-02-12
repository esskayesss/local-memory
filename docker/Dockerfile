FROM oven/bun:1.3.5 AS base
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production

CMD ["bun", "run", "start:docker"]
