# Home Assistant Add-on Dockerfile
ARG BUILD_FROM=ghcr.io/hassio-addons/base:15.0.8
FROM ${BUILD_FROM}

# Build arguments
ARG BUILD_ARCH=amd64
ARG BUILD_DATE
ARG BUILD_VERSION

# Install Node.js 20 and required packages
RUN apk add --no-cache \
    nodejs \
    npm \
    curl

# Set working directory
WORKDIR /app

# Copy package files first (for better caching)
COPY package*.json ./

# Install ALL dependencies (including dev for build)
RUN npm ci --include=dev

# Copy TypeScript config and source
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Remove dev dependencies, source and cache for smaller image
RUN npm prune --omit=dev && \
    rm -rf src tsconfig.json && \
    npm cache clean --force && \
    rm -rf /root/.npm

# Copy run script
COPY run.sh /
RUN chmod a+x /run.sh

# Health check for watchdog
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8099/health || exit 1

# Labels
LABEL \
    io.hass.name="Dumio Agent" \
    io.hass.description="Agente inteligente para Home Assistant con soporte cloud" \
    io.hass.arch="${BUILD_ARCH}" \
    io.hass.type="addon" \
    io.hass.version="${BUILD_VERSION:-1.0.0}" \
    org.opencontainers.image.title="Dumio Agent" \
    org.opencontainers.image.description="Agente inteligente para Home Assistant" \
    org.opencontainers.image.vendor="DumioHome" \
    org.opencontainers.image.authors="Juan Ignacio Melo" \
    org.opencontainers.image.licenses="AGPL-3.0" \
    org.opencontainers.image.source="https://github.com/DumioHome/dumio-agent" \
    org.opencontainers.image.created="${BUILD_DATE}"

CMD ["/run.sh"]
