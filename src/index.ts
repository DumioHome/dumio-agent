import { loadConfig, validateConfig } from './infrastructure/config/Config.js';
import { PinoLogger } from './infrastructure/logging/PinoLogger.js';
import { HomeAssistantClient } from './infrastructure/websocket/HomeAssistantClient.js';
import { Agent } from './presentation/Agent.js';
import type { EntityState, HAEventMessage } from './domain/index.js';
import type { ConnectionState } from './domain/ports/IHomeAssistantClient.js';

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
    haUrl: config.homeAssistant.url,
  });

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

  // Handle graceful shutdown
  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down...');
    await agent.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    // Start the agent
    await agent.start(handlers);

    // Example: List all lights
    const lights = await agent.getEntitiesByDomain('light');
    logger.info('Available lights', {
      count: lights.length,
      entities: lights.map((l) => l.entity_id),
    });

    // Keep the process running
    logger.info('Agent is running. Press Ctrl+C to stop.');

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
export { HomeAssistantClient } from './infrastructure/websocket/HomeAssistantClient.js';
export { PinoLogger } from './infrastructure/logging/PinoLogger.js';
export { loadConfig, validateConfig } from './infrastructure/config/Config.js';
export * from './domain/index.js';
export * from './application/index.js';
