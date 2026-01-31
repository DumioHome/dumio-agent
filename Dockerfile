# Home Assistant Add-on Dockerfile
# https://developers.home-assistant.io/docs/add-ons/configuration#add-on-dockerfile

ARG BUILD_FROM
FROM ${BUILD_FROM:-node:20-alpine}

# Build arguments
ARG BUILD_ARCH
ARG BUILD_DATE
ARG BUILD_REF
ARG BUILD_VERSION

# Install bashio for Home Assistant integration
RUN apk add --no-cache \
    bash \
    curl \
    jq \
    && curl -J -L -o /tmp/bashio.tar.gz \
    "https://github.com/hassio-addons/bashio/archive/v0.16.2.tar.gz" \
    && mkdir /tmp/bashio \
    && tar zxvf /tmp/bashio.tar.gz --strip 1 -C /tmp/bashio \
    && mv /tmp/bashio/lib /usr/lib/bashio \
    && ln -s /usr/lib/bashio/bashio /usr/bin/bashio \
    && rm -rf /tmp/bashio.tar.gz /tmp/bashio

# Set shell
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production=false

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build the application
RUN npm run build \
    && npm prune --production \
    && rm -rf src tsconfig.json

# Copy run script
COPY run.sh /
RUN chmod +x /run.sh

# Labels
LABEL \
    io.hass.name="Dumio Agent" \
    io.hass.description="Agente inteligente para Home Assistant con comunicación WebSocket" \
    io.hass.arch="${BUILD_ARCH}" \
    io.hass.type="addon" \
    io.hass.version="${BUILD_VERSION}" \
    maintainer="Juan Ignacio Melo" \
    org.opencontainers.image.title="Dumio Agent" \
    org.opencontainers.image.description="Agente inteligente para Home Assistant" \
    org.opencontainers.image.vendor="Dumio" \
    org.opencontainers.image.authors="Juan Ignacio Melo" \
    org.opencontainers.image.source="https://github.com/yourusername/dumio-agent" \
    org.opencontainers.image.created="${BUILD_DATE}" \
    org.opencontainers.image.revision="${BUILD_REF}" \
    org.opencontainers.image.version="${BUILD_VERSION}"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8099/health || exit 1

# Start the add-on
CMD ["/run.sh"]
