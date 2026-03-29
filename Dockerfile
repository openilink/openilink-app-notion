# ─── 构建阶段 ───────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ─── 运行阶段 ───────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# better-sqlite3 需要构建原生模块
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# 清理构建依赖
RUN apk del python3 make g++

COPY --from=builder /app/dist ./dist

# 数据目录
ENV DB_PATH=/data/notion.db
RUN mkdir -p /data

EXPOSE 8087

CMD ["node", "dist/index.js"]
