import { createServer } from 'http';
import { loadConfig, validateConfig } from './infrastructure/config/Config.js';
import { PinoLogger } from './infrastructure/logging/PinoLogger.js';
import { HomeAssistantClient } from './infrastructure/websocket/HomeAssistantClient.js';
import { Agent } from './presentation/Agent.js';
import { HttpServer } from './presentation/HttpServer.js';
import type { EntityState, HAEventMessage } from './domain/index.js';
import type { ConnectionState } from './domain/ports/IHomeAssistantClient.js';

const HEALTH_CHECK_PORT = 8099;
const HTTP_API_PORT = 3000;

/**
 * Start health check server for Home Assistant watchdog
 */
function startHealthCheckServer(logger: ReturnType<typeof PinoLogger.prototype.child>): void {
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(HEALTH_CHECK_PORT, () => {
    logger.debug('Health check server started', { port: HEALTH_CHECK_PORT });
  });
}

/**
 * Main entry point for the Dumio Agent
 */
async function main(): Promise<void> {
  // Load and validate configuration
  const config = loadConfig();
  validateConfig(config);

  // Initialize logger
  const logger = new PinoLogger({
    name: config.agent.name,
    level: config.logging.level,
    pretty: config.logging.pretty,
  });

  logger.info('Dumio Agent starting', {
    name: config.agent.name,
    mode: config.isAddon ? 'Home Assistant Add-on' : 'Standalone',
    haUrl: config.isAddon ? '(supervisor internal)' : config.homeAssistant.url,
  });

  // Start health check server (for add-on watchdog)
  if (config.isAddon) {
    startHealthCheckServer(logger);
  }

  // Initialize Home Assistant client
  const haClient = new HomeAssistantClient(
    {
      url: config.homeAssistant.url,
      accessToken: config.homeAssistant.accessToken,
      reconnectInterval: config.reconnection.interval,
      maxReconnectAttempts: config.reconnection.maxAttempts,
    },
    logger.child({ component: 'HomeAssistantClient' })
  );

  // Initialize Agent
  const agent = new Agent(
    haClient,
    logger.child({ component: 'Agent' }),
    {
      name: config.agent.name,
      subscribeOnConnect: true,
    }
  );

  // Event handlers
  const handlers = {
    onStateChange: (entityId: string, _oldState: EntityState | null, newState: EntityState): void => {
      logger.debug('State changed', {
        entityId,
        state: newState.state,
        attributes: Object.keys(newState.attributes),
      });
    },
    onEvent: (event: HAEventMessage): void => {
      logger.trace('Event received', {
        eventType: event.event.event_type,
      });
    },
    onConnectionChange: (state: ConnectionState): void => {
      logger.info('Connection state changed', { state });
    },
  };

  // Initialize HTTP Server for API access
  const httpServer = new HttpServer(
    agent,
    logger.child({ component: 'HttpServer' }),
    { port: HTTP_API_PORT }
  );

  // Handle graceful shutdown
  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down...');
    await httpServer.stop();
    await agent.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    // Start the agent
    await agent.start(handlers);

    // Start HTTP API server
    await httpServer.start();

    // Log available entities count
    const stats = await agent.getDeviceStats();
    logger.info('Connected to Home Assistant', {
      totalDevices: stats.total,
      onlineDevices: stats.online,
      activeDevices: stats.on,
    });

    // Keep the process running
    if (config.isAddon) {
      logger.info('Add-on is running and connected to Home Assistant');
    } else {
      logger.info(`Agent is running. API available at http://localhost:${HTTP_API_PORT}`);
      logger.info('Press Ctrl+C to stop.');
    }

    // The agent will keep running and processing events
    // until SIGINT or SIGTERM is received

  } catch (error) {
    logger.fatal('Failed to start agent', error);
    process.exit(1);
  }
}

// Run the main function
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});

// Export for programmatic use
export { Agent } from './presentation/Agent.js';
export { HttpServer } from './presentation/HttpServer.js';
export { HomeAssistantClient } from './infrastructure/websocket/HomeAssistantClient.js';
export { PinoLogger } from './infrastructure/logging/PinoLogger.js';
export { loadConfig, validateConfig } from './infrastructure/config/Config.js';
export { DeviceMapper, RoomMapper } from './infrastructure/mappers/index.js';
export * from './domain/index.js';
export * from './application/index.js';
