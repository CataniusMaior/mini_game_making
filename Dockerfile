# DRIFT ARK in a container: a small Node.js web server for the game's files.
#
#   docker compose up --build          build, then start the server
#   open http://localhost:9410/        play in your own browser
#
# Without compose:
#   docker build -t drift-ark .
#   docker run --rm -it --init -p 127.0.0.1:9410:9410 drift-ark
FROM node:22-alpine

WORKDIR /app
# The server has no dependencies, so there is nothing to install: copy the
# server and the game's files (index.html, css/, js/) only.
COPY server.mjs index.html ./
COPY css ./css
COPY js ./js

# Inside a container the server must listen on all interfaces to be
# reachable through the published port.
ENV DRIFTARK_HOST=0.0.0.0 \
    DRIFTARK_PORT=9410 \
    DRIFTARK_IN_DOCKER=1
EXPOSE 9410

USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:9410/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["node", "server.mjs"]
