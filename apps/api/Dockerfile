FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install

FROM deps AS build
COPY apps/api apps/api
COPY tsconfig.json* ./
RUN npm --workspace apps/api run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
RUN npm install --omit=dev --workspace apps/api
COPY --from=build /app/apps/api/dist apps/api/dist
EXPOSE 8787
CMD ["node", "apps/api/dist/server.js"]
