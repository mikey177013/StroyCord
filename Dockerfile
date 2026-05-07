FROM node:24-alpine AS build
WORKDIR /build

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production

WORKDIR /app
RUN apk add --no-cache ffmpeg python3

COPY --from=build /build/dist ./dist
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/package.json ./

# sqlite db file lives in /app/data — mount a volume here to persist across rebuilds
RUN mkdir -p /app/data && chown -R node:node /app
WORKDIR /app/data
WORKDIR /app

USER node
CMD ["node", "dist/Bot.js"]
