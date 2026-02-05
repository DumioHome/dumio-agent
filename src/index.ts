import { createServer } from "http";
import { loadConfig, validateConfig } from "./infrastructure/config/Config.js";
import { PinoLogger } from "./infrastructure/logging/PinoLogger.js";
import { HomeAssistantClient } from "./infrastructure/websocket/HomeAssistantClient.js";
import { CloudClient } from "./infrastructure/cloud/CloudClient.js";
import { getDumioDeviceId } from "./infrastructure/utils/deviceId.js";
import { Agent } from "./presentation/Agent.js";
import { HttpServer } from "./presentation/HttpServer.js";
import type { EntityState, HAEventMessage } from "./domain/index.js";
import type { ConnectionState } from "./domain/ports/IHomeAssistantClient.js";
import type { AgentHealthData, DeviceUpdate } from "./domain/ports/ICloudClient.js";
import { DeviceCapabilityMapper } from "./infrastructure/mappers/index.js";

// Agent version
const AGENT_VERSION = "1.0.0";

const HEALTH_CHECK_PORT = 8099;
const HTTP_API_PORT = 3000;

/**
 * Start health check server for Home Assistant watchdog
 */
function startHealthCheckServer(
  logger: ReturnType<typeof PinoLogger.prototype.child>
): void {
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "healthy",
          timestamp: new Date().toISOString(),
        })
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(HEALTH_CHECK_PORT, () => {
    logger.debug("Health check server started", { port: HEALTH_CHECK_PORT });
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

  // Start time for uptime calculation
  const startTime = Date.now();

  logger.info("Dumio Agent starting", {
    name: config.agent.name,
    mode: config.isAddon ? "Home Assistant Add-on" : "Standalone",
    haUrl: config.isAddon ? "(supervisor internal)" : config.homeAssistant.url,
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
    logger.child({ component: "HomeAssistantClient" })
  );

  // Initialize Cloud Client (if configured) - before Agent so we can pass it
  let cloudClient: CloudClient | null = null;
  if (config.cloud.enabled) {
    cloudClient = new CloudClient(
      {
        socketUrl: config.cloud.socketUrl,
        apiKey: config.cloud.apiKey,
        agentId: config.agent.name,
      },
      logger.child({ component: "CloudClient" })
    );
  }

  // Get configured device ID (only if explicitly set) - needed for Agent config
  const dumioDeviceId = getDumioDeviceId(config.agent.dumioDeviceId);

  // Initialize Agent with optional cloud client
  const agent = new Agent(haClient, logger.child({ component: "Agent" }), {
    name: config.agent.name,
    subscribeOnConnect: true,
    cloudClient: cloudClient ?? undefined,
    dumioDeviceId: dumioDeviceId ?? undefined,
  });

  // Initialize HTTP Server for API access
  const httpServer = new HttpServer(
    agent,
    logger.child({ component: "HttpServer" }),
    { port: HTTP_API_PORT }
  );

  // Configure status provider for HTTP endpoints (smart cache - only fetches when invalidated)
  httpServer.setStatusProvider(async () => {
    const stats = await agent.getDeviceStats();
    const entities = await agent.getState();
    return {
      version: AGENT_VERSION,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      websocket: {
        state: haClient.connectionState,
        connected: haClient.connectionState === "connected",
        url: config.isAddon
          ? "ws://supervisor/core/websocket"
          : config.homeAssistant.url,
      },
      homeAssistant: {
        entityCount: entities.length,
        deviceCount: stats.total,
      },
    };
  });

  /**
   * Same as POST /api/devices/sync: run full sync (HA → cloud) so agent stays in sync after
   * addon/HA startup (e.g. after power outage). Only runs when both HA and cloud are connected.
   */
  const ensureDeviceSyncInitialized = async (): Promise<void> => {
    if (!cloudClient || !dumioDeviceId) return;

    if (haClient.connectionState !== "connected") {
      logger.info(
        "Skipping auto-sync: Home Assistant not connected yet (will sync when HA is ready)"
      );
      return;
    }

    const syncManager = agent.getCapabilitySyncManager();
    if (syncManager && !syncManager.active) {
      logger.info("Attempting to restore sync state from cloud");
      const restored = await agent.restoreSyncFromCloud();
      if (restored) {
        logger.info("Sync state restored successfully");
      } else {
        await runFullSyncFromCloud();
      }
      return;
    }

    if (!syncManager) {
      await runFullSyncFromCloud();
    }
  };

  /**
   * Get homeId from cloud and run full devices sync (same as /api/devices/sync with that homeId).
   */
  const runFullSyncFromCloud = async (): Promise<void> => {
    if (!cloudClient || !dumioDeviceId) return;

    try {
      const response = await cloudClient.emitWithCallback(
        "devices:fetch",
        { dumioDeviceId },
        30000
      );

      if (!response.success || !response.homeId) {
        logger.info(
          "No homeId from cloud for this agent, skipping auto-sync (use POST /api/devices/sync with homeId if needed)"
        );
        return;
      }

      logger.info("Running auto-sync (same as /api/devices/sync)", {
        homeId: response.homeId,
        deviceCountInCloud: response.devices?.length ?? 0,
      });

      const syncResult = await agent.syncDevicesToCloud(response.homeId);

      if (syncResult.success) {
        logger.info("Auto-sync completed after startup", {
          syncedDevices: syncResult.syncedDevices,
          watching: syncResult.watching,
        });
      } else {
        logger.warn("Auto-sync finished with errors", {
          error: syncResult.error,
          syncedDevices: syncResult.syncedDevices,
        });
      }
    } catch (error) {
      logger.error("Auto-sync failed (fetch homeId or sync)", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // Event handlers - notify httpServer of changes to invalidate cache
  const handlers = {
    onStateChange: (
      entityId: string,
      _oldState: EntityState | null,
      newState: EntityState
    ): void => {
      logger.debug("State changed", {
        entityId,
        state: newState.state,
        attributes: Object.keys(newState.attributes),
      });
      
      // Send device state update to cloud if enabled (async, fire and forget)
      if (cloudClient && cloudClient.connectionState === "connected") {
        // Execute async operation without blocking
        (async () => {
          try {
            // Get the current state of the entity (already have newState, but need full device info)
            // Get the device with full details for this entity
            // Use search filter which includes entityId matching
            const devices = await agent.getDevicesWithDetails({
              search: entityId,
              includeAll: true,
            });

            // Find the device matching the entityId exactly
            const device = devices.find((d) => d.entityId === entityId);

            if (device) {
              // Extract capabilities with correct capabilityType mapping
              const capabilities = DeviceCapabilityMapper.extractCapabilities(device);

              // Map device to cloud update format
              const deviceUpdate: DeviceUpdate = {
                id: device.id, // UUID del dispositivo en Dumio (requerido)
                deviceId: device.id, // Identificador del dispositivo en Home Assistant
                entityIds: [device.entityId], // Array de entity_ids relacionados
                name: device.name,
                deviceType: device.type, // Tipo correctamente mapeado (sensor, power, switch, etc.)
                model: device.model ?? undefined,
                manufacturer: device.manufacturer ?? undefined,
                capabilities: capabilities.map((cap) => ({
                  capabilityType: cap.capabilityType,
                  valueType: cap.valueType,
                  currentValue: cap.currentValue,
                  meta: cap.meta,
                })),
              };

              cloudClient.emit("device:update", deviceUpdate);
              logger.debug("Device update sent to cloud", {
                entityId,
                deviceType: device.type,
                capabilities: capabilities.map((c) => c.capabilityType),
              });
            } else {
              logger.debug(
                "Device not found for entity, skipping cloud update",
                { entityId }
              );
            }
          } catch (error) {
            logger.error("Failed to send device state update to cloud", {
              entityId,
              error,
            });
          }
        })().catch((error) => {
          logger.error("Unhandled error in device state update handler", {
            entityId,
            error,
          });
        });
      }
      
      // Don't invalidate on every state change (too frequent)
      // Only invalidate on significant changes like device added/removed
    },
    onEvent: (event: HAEventMessage): void => {
      logger.trace("Event received", {
        eventType: event.event.event_type,
      });

      // Invalidate cache on significant events
      const significantEvents = [
        "device_registry_updated",
        "entity_registry_updated",
        "area_registry_updated",
        "homeassistant_start",
        "homeassistant_stop",
      ];

      if (significantEvents.includes(event.event.event_type)) {
        logger.info("Significant event detected, invalidating cache", {
          eventType: event.event.event_type,
        });
        httpServer.invalidateCache();
      }
    },
    onConnectionChange: (state: ConnectionState): void => {
      logger.info("Connection state changed", { state });
      // Notify httpServer to invalidate cache on connection change
      httpServer.onConnectionChange(state);
      // When HA (re)connects, ensure device sync is initialized so control works (e.g. after HA restart)
      if (
        state === "connected" &&
        cloudClient &&
        dumioDeviceId &&
        cloudClient.connectionState === "connected"
      ) {
        ensureDeviceSyncInitialized().catch((err) =>
          logger.error("Ensure sync after HA connected failed", {
            error: err instanceof Error ? err.message : String(err),
          })
        );
      }
    },
  };

  if (dumioDeviceId) {
    logger.info("Dumio Device ID configured", { dumioDeviceId });
  } else {
    logger.info("Dumio Device ID not configured - health reporting disabled");
  }

  /**
   * Map HA connection state to health status
   */
  const mapConnectionToStatus = (
    state: ConnectionState
  ): AgentHealthData["status"] => {
    switch (state) {
      case "connected":
        return "online";
      case "connecting":
      case "authenticating":
        return "connecting";
      case "disconnected":
        return "offline";
      case "error":
        return "error";
      default:
        return "offline";
    }
  };

  /**
   * Generate health data for cloud reporting
   * Only available if dumioDeviceId is configured
   */
  const getHealthData = dumioDeviceId
    ? async (): Promise<AgentHealthData> => {
        const stats = await agent.getDeviceStats();
        const entities = await agent.getState();

        return {
          dumioDeviceId,
          status: mapConnectionToStatus(haClient.connectionState),
          timestamp: new Date().toISOString(),
          homeAssistant: {
            connected: haClient.connectionState === "connected",
            entityCount: entities.length,
            deviceCount: stats.total,
          },
          agent: {
            name: config.agent.name,
            version: AGENT_VERSION,
            uptime: Math.floor((Date.now() - startTime) / 1000),
          },
        };
      }
    : null;

  // Handle graceful shutdown
  const shutdown = async (): Promise<void> => {
    logger.info("Shutting down...");
    if (cloudClient) {
      await cloudClient.disconnect();
    }
    await httpServer.stop();
    await agent.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    // Start the agent
    await agent.start(handlers);

    // Start HTTP API server
    await httpServer.start();

    // Log available entities count
    const stats = await agent.getDeviceStats();
    logger.info("Connected to Home Assistant", {
      totalDevices: stats.total,
      onlineDevices: stats.online,
      activeDevices: stats.on,
    });

    // Connect to cloud if enabled
    if (cloudClient) {
      try {
        await cloudClient.connect();
        logger.info("Connected to cloud", { url: config.cloud.socketUrl });

        // Start health reporting only if dumioDeviceId is configured
        if (getHealthData) {
          cloudClient.startHealthReporting(getHealthData, 30000);

          // Register health request handler
          cloudClient.on("health:request", async () => {
            const healthData = await getHealthData();
            cloudClient?.sendHealth(healthData);
          });
        } else {
          logger.info(
            "Health reporting disabled - no dumioDeviceId configured"
          );
        }

        cloudClient.on("devices:request", async (data) => {
          const devices = await agent.getDevices(data.filter);
          cloudClient?.emit("devices:response", devices);
        });

        cloudClient.on("rooms:request", async () => {
          const rooms = await agent.getRooms();
          cloudClient?.emit("rooms:response", rooms);
        });

        cloudClient.on("command:execute", async (data) => {
          try {
            const [domain, service] = data.command.split(".");
            const result = await agent.callService(
              domain,
              service,
              data.params?.entity_id as string | undefined,
              data.params
            );
            cloudClient?.emit("command:result", result);
          } catch (error) {
            cloudClient?.emit("command:result", {
              success: false,
              message: error instanceof Error ? error.message : "Unknown error",
            });
          }
        });

        // Handle device control commands from cloud
        cloudClient.on("device:control", async (command) => {
          logger.info("Device control command received", {
            deviceId: command.deviceId,
            capabilityType: command.capabilityType,
            value: command.value,
          });

          const result = await agent.controlDevice(command);
          cloudClient?.emit("device:control:response", result);

          logger.info("Device control command completed", {
            deviceId: command.deviceId,
            success: result.success,
            message: result.message,
          });
        });

        // On cloud connect/reconnect: restore or initialize sync so device control works
        cloudClient.onConnectionStateChange(async (state) => {
          if (state === "connected") {
            logger.info("Cloud connected, ensuring device sync is initialized");
            ensureDeviceSyncInitialized().catch((err) =>
              logger.error("Ensure sync after cloud connect failed", {
                error: err instanceof Error ? err.message : String(err),
              })
            );
          }
        });
      } catch (error) {
        logger.error("Failed to connect to cloud", { error });
        // Continue running without cloud connection
      }
    }

    // Keep the process running
    if (config.isAddon) {
      logger.info("Add-on is running and connected to Home Assistant");
    } else {
      logger.info(
        `Agent is running. API available at http://localhost:${HTTP_API_PORT}`
      );
      if (config.cloud.enabled) {
        logger.info(
          `Cloud connection: ${cloudClient?.connectionState ?? "disabled"}`
        );
      }
      logger.info("Press Ctrl+C to stop.");
    }

    // The agent will keep running and processing events
    // until SIGINT or SIGTERM is received
  } catch (error) {
    logger.fatal("Failed to start agent", error);
    process.exit(1);
  }
}

// Run the main function
main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});

// Export for programmatic use
export { Agent } from "./presentation/Agent.js";
export { HttpServer } from "./presentation/HttpServer.js";
export { HomeAssistantClient } from "./infrastructure/websocket/HomeAssistantClient.js";
export { CloudClient } from "./infrastructure/cloud/CloudClient.js";
export { PinoLogger } from "./infrastructure/logging/PinoLogger.js";
export { loadConfig, validateConfig } from "./infrastructure/config/Config.js";
export { DeviceMapper, RoomMapper } from "./infrastructure/mappers/index.js";
export * from "./domain/index.js";
export * from "./application/index.js";
