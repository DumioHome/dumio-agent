#!/usr/bin/with-contenv bashio
# ==============================================================================
# Dumio Agent - Home Assistant Add-on
# Starts the Dumio Agent service
# ==============================================================================

# Get Supervisor token for Home Assistant API
export HA_ACCESS_TOKEN="${SUPERVISOR_TOKEN}"

# Get Home Assistant WebSocket URL (internal)
export HA_URL="ws://supervisor/core/websocket"

# Read add-on options
export LOG_LEVEL=$(bashio::config 'log_level')
export RECONNECT_INTERVAL=$(bashio::config 'reconnect_interval')
export MAX_RECONNECT_ATTEMPTS=$(bashio::config 'max_reconnect_attempts')
export AGENT_NAME="dumio-agent"

# Log startup information
bashio::log.info "Starting Dumio Agent..."
bashio::log.info "Log Level: ${LOG_LEVEL}"
bashio::log.info "Reconnect Interval: ${RECONNECT_INTERVAL}ms"
bashio::log.info "Max Reconnect Attempts: ${MAX_RECONNECT_ATTEMPTS}"

# Start the application
exec node /app/dist/index.js
