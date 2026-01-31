#!/usr/bin/with-contenv bashio
# ==============================================================================
# Dumio Agent - Home Assistant Add-on
# Starts the Dumio Agent service
# ==============================================================================

set -e

bashio::log.info "=============================================="
bashio::log.info "  Dumio Agent - Home Assistant Add-on"
bashio::log.info "=============================================="

# ------------------------------------------------------------------------------
# Validate Supervisor Token
# ------------------------------------------------------------------------------
if [ -z "${SUPERVISOR_TOKEN:-}" ]; then
    bashio::log.fatal "SUPERVISOR_TOKEN not available!"
    bashio::log.fatal "Make sure the add-on has 'homeassistant_api: true' in config.yaml"
    exit 1
fi

# Get Supervisor token for Home Assistant API
export HA_ACCESS_TOKEN="${SUPERVISOR_TOKEN}"

# Get Home Assistant WebSocket URL (internal supervisor URL)
export HA_URL="ws://supervisor/core/websocket"

# ------------------------------------------------------------------------------
# Read add-on configuration
# ------------------------------------------------------------------------------
bashio::log.info "Loading configuration..."

# Log level
export LOG_LEVEL=$(bashio::config 'log_level' 'info')

# Reconnection settings
export RECONNECT_INTERVAL=$(bashio::config 'reconnect_interval' '5000')
export MAX_RECONNECT_ATTEMPTS=$(bashio::config 'max_reconnect_attempts' '10')

# API settings
ENABLE_API=$(bashio::config 'enable_api' 'true')
export ENABLE_API

# Cloud configuration (optional)
if bashio::config.has_value 'cloud_socket_url'; then
    export CLOUD_SOCKET_URL=$(bashio::config 'cloud_socket_url')
    bashio::log.info "Cloud Socket URL configured"
fi

if bashio::config.has_value 'cloud_api_key'; then
    export CLOUD_API_KEY=$(bashio::config 'cloud_api_key')
    bashio::log.info "Cloud API Key configured"
fi

# Agent identification
export AGENT_NAME="dumio-agent"
export NODE_ENV="production"

# ------------------------------------------------------------------------------
# Log configuration summary
# ------------------------------------------------------------------------------
bashio::log.info "----------------------------------------------"
bashio::log.info "Configuration:"
bashio::log.info "  Log Level:              ${LOG_LEVEL}"
bashio::log.info "  Reconnect Interval:     ${RECONNECT_INTERVAL}ms"
bashio::log.info "  Max Reconnect Attempts: ${MAX_RECONNECT_ATTEMPTS}"
bashio::log.info "  Enable API:             ${ENABLE_API}"
bashio::log.info "  WebSocket URL:          ${HA_URL}"
if [ -n "${CLOUD_SOCKET_URL:-}" ]; then
    bashio::log.info "  Cloud:                  Enabled"
else
    bashio::log.info "  Cloud:                  Disabled"
fi
bashio::log.info "----------------------------------------------"

# ------------------------------------------------------------------------------
# Wait for Home Assistant to be ready
# ------------------------------------------------------------------------------
bashio::log.info "Waiting for Home Assistant to be ready..."
bashio::net.wait_for 80 supervisor 300 || {
    bashio::log.fatal "Home Assistant Supervisor not reachable!"
    exit 1
}
bashio::log.info "Home Assistant Supervisor is ready"

# ------------------------------------------------------------------------------
# Start the application
# ------------------------------------------------------------------------------
bashio::log.info "Starting Node.js application..."
cd /app

# Run with proper signal handling
exec node dist/index.js
