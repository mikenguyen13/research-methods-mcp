# Self-hosting, Glama, and the Docker MCP Catalog.
#   docker build -t research-methods-mcp .
#   docker run -p 8080:8080 research-methods-mcp          # HTTP: http://localhost:8080/mcp
#   docker run -i research-methods-mcp node dist/stdio.js # stdio

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN node scripts/bundle.mjs

FROM node:24-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/data/index.json.gz /app/data/search.json.gz ./data/
ENV HOST=0.0.0.0 PORT=8080 NODE_ENV=production
EXPOSE 8080
USER node
CMD ["node", "dist/http.js"]
