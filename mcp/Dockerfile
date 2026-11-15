# team-review：每天定时生成团队回顾。也可以当 team-mcp 的运行环境。
FROM node:24-alpine
RUN apk add --no-cache python3 tzdata
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY dist ./dist
COPY skills ./skills
ENV TZ=Asia/Shanghai
CMD ["node", "dist/cli.js", "--daemon"]
