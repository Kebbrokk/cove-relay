# Cove Relay — container image for one-command deploys
# (Fly.io, Railway, Render, or any Docker host). Builds a tiny image that runs
# the relay and serves the player "seat" page it reads from ../src.
FROM node:20-slim

WORKDIR /app

# Install only the relay's production dependency (ws), using its lockfile.
COPY relay/package.json relay/package-lock.json ./relay/
RUN cd relay && npm ci --omit=dev

# The relay server and the seat-page assets it serves.
COPY relay ./relay
COPY src ./src

# The relay honors PORT (default 8080). Hosts that inject their own PORT
# (Railway, Render, …) override this automatically.
ENV PORT=8080
EXPOSE 8080

CMD ["node", "relay/server.js"]
