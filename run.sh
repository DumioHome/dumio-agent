#!/usr/bin/with-contenv bashio
# ==============================================================================
# Dumio Agent - Home Assistant Add-on
# Starts the Dumio Agent service
# ==============================================================================

bashio::log.info "Starting Dumio Agent..."

# Get Supervisor token for Home Assistant API
export HA_ACCESS_TOKEN="${SUPERVISOR_TOKEN}"

# Get Home Assistant WebSocket URL (internal supervisor URL)
export HA_URL="ws://supervisor/core/websocket"

# Read add-on options with defaults
if bashio::config.exists 'log_level'; then
    export LOG_LEVEL=$(bashio::config 'log_level')
else
    export LOG_LEVEL="info"
fi

if bashio::config.exists 'reconnect_interval'; then
    export RECONNECT_INTERVAL=$(bashio::config 'reconnect_interval')
else
    export RECONNECT_INTERVAL="5000"
fi

if bashio::config.exists 'max_reconnect_attempts'; then
    export MAX_RECONNECT_ATTEMPTS=$(bashio::config 'max_reconnect_attempts')
else
    export MAX_RECONNECT_ATTEMPTS="10"
fi

# Cloud configuration (optional)
if bashio::config.exists 'cloud_socket_url' && bashio::config.has_value 'cloud_socket_url'; then
    export CLOUD_SOCKET_URL=$(bashio::config 'cloud_socket_url')
    bashio::log.info "Cloud Socket URL configured"
fi

if bashio::config.exists 'cloud_api_key' && bashio::config.has_value 'cloud_api_key'; then
    export CLOUD_API_KEY=$(bashio::config 'cloud_api_key')
    bashio::log.info "Cloud API Key configured"
fi

export AGENT_NAME="dumio-agent"
export NODE_ENV="production"

# Log startup information
bashio::log.info "Configuration:"
bashio::log.info "  - Log Level: ${LOG_LEVEL}"
bashio::log.info "  - Reconnect Interval: ${RECONNECT_INTERVAL}ms"
bashio::log.info "  - Max Reconnect Attempts: ${MAX_RECONNECT_ATTEMPTS}"
bashio::log.info "  - WebSocket URL: ${HA_URL}"
if [ -n "${CLOUD_SOCKET_URL:-}" ]; then
    bashio::log.info "  - Cloud: Enabled"
else
    bashio::log.info "  - Cloud: Disabled (no URL configured)"
fi

# Start the application
bashio::log.info "Starting Node.js application..."
cd /app
exec node dist/index.js
