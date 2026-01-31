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

export AGENT_NAME="dumio-agent"
export NODE_ENV="production"

# Log startup information
bashio::log.info "Configuration:"
bashio::log.info "  - Log Level: ${LOG_LEVEL}"
bashio::log.info "  - Reconnect Interval: ${RECONNECT_INTERVAL}ms"
bashio::log.info "  - Max Reconnect Attempts: ${MAX_RECONNECT_ATTEMPTS}"
bashio::log.info "  - WebSocket URL: ${HA_URL}"

# Start the application
bashio::log.info "Starting Node.js application..."
cd /app
exec node dist/index.js
