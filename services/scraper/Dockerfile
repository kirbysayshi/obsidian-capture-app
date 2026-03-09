FROM node:22-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN npm install -g pnpm && pnpm install --prod --frozen-lockfile

COPY dist/ ./dist/

EXPOSE 8080
CMD ["node", "dist/index.js"]
