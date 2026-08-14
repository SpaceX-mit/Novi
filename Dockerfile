FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-alpine AS runtime
WORKDIR /app
# npm/corepack are build tools, not runtime dependencies. Removing them keeps
# their bundled dependency trees out of the production attack surface.
RUN npm uninstall --global npm corepack
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json server.mjs ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node data ./data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173 NOVI_DATA_FILE=/app/data/novi.json NOVI_COOKIE_SECURE=true NOVI_REQUIRE_NATIVE_VECTOR=true
# Set NOVI_STORAGE=postgres and NOVI_PG_URL at runtime to use the transactional adapter.
VOLUME ["/app/data"]
EXPOSE 4173
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD node -e "fetch('http://127.0.0.1:4173/api/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
