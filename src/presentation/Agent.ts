import type {
  IHomeAssistantClient,
  ConnectionState,
} from "../domain/ports/IHomeAssistantClient.js";
import type { ICloudClient } from "../domain/ports/ICloudClient.js";
import type { ILogger } from "../domain/ports/ILogger.js";
import type {
  EntityState,
  HAEventMessage,
  Device,
  DeviceSummary,
  DeviceFilter,
  DeviceType,
  Room,
  RoomWithDevices,
  HomeOverview,
} from "../domain/index.js";
import {
  ConnectToHomeAssistant,
  CallService,
  GetEntityState,
  ProcessConversation,
  SubscribeToEvents,
  GetDevices,
  GetRooms,
  SyncDevicesToCloud,
  CapabilitySyncManager,
} from "../application/index.js";
import type {
  DeviceControlCommand,
  DeviceControlResponse,
} from "../domain/entities/CloudDevice.js";

export interface AgentConfig {
  name: string;
  autoReconnect?: boolean;
  subscribeOnConnect?: boolean;
  cloudClient?: ICloudClient;
  /** Dumio device ID for cloud sync features */
  dumioDeviceId?: string;
}

export interface AgentEventHandlers {
  onStateChange?: (
    entityId: string,
    oldState: EntityState | null,
    newState: EntityState
  ) => void;
  onEvent?: (event: HAEventMessage) => void;
  onConnectionChange?: (state: ConnectionState) => void;
}

/**
 * Main Agent class that orchestrates Home Assistant interactions
 */
export class Agent {
  private connectUseCase: ConnectToHomeAssistant;
  private callServiceUseCase: CallService;
  private getEntityStateUseCase: GetEntityState;
  private processConversationUseCase: ProcessConversation;
  private subscribeToEventsUseCase: SubscribeToEvents;
  private getDevicesUseCase: GetDevices;
  private getRoomsUseCase: GetRooms;
  private eventSubscription?: { unsubscribe: () => Promise<void> };
  private capabilitySyncManager?: CapabilitySyncManager;
  /** Handlers guardados para re-suscribir tras reconexión (resync de estados). */
  private storedEventHandlers?: AgentEventHandlers;

  constructor(
    private readonly haClient: IHomeAssistantClient,
    private readonly logger: ILogger,
    private readonly config: AgentConfig
  ) {
    // Initialize use cases
    this.connectUseCase = new ConnectToHomeAssistant(haClient, logger);
    this.callServiceUseCase = new CallService(haClient, logger);
    this.getEntityStateUseCase = new GetEntityState(haClient, logger);
    this.processConversationUseCase = new ProcessConversation(haClient, logger);
    this.subscribeToEventsUseCase = new SubscribeToEvents(haClient, logger);
    this.getDevicesUseCase = new GetDevices(haClient, logger);
    this.getRoomsUseCase = new GetRooms(haClient, logger);

    this.logger.info("Agent initialized", { name: config.name });
  }

  /**
   * Start the agent and connect to Home Assistant
   */
  async start(handlers?: AgentEventHandlers): Promise<void> {
    this.logger.info("Starting agent", { name: this.config.name });
    this.storedEventHandlers = handlers;

    // Register connection state handler
    if (handlers?.onConnectionChange) {
      this.haClient.onConnectionStateChange(handlers.onConnectionChange);
    }

    // Connect to Home Assistant
    const connectResult = await this.connectUseCase.execute({
      subscribeToStateChanges: this.config.subscribeOnConnect,
    });

    this.logger.info("Connected to Home Assistant", {
      version: connectResult.haVersion,
      entityCount: connectResult.entityCount,
    });

    // Subscribe to events with handlers
    if (handlers?.onEvent || handlers?.onStateChange) {
      this.eventSubscription = await this.subscribeToEventsUseCase.execute({
        onEvent: handlers.onEvent,
        onStateChange: handlers.onStateChange,
      });
    }

    this.logger.info("Agent started successfully");
  }

  /**
   * Tras reconexión de HA: refresca caché de estados (getStates) y re-suscribe
   * a state_changed para que las entidades en HA no queden desfasadas.
   */
  async resyncAfterHaReconnect(): Promise<void> {
    if (this.haClient.connectionState !== "connected") return;

    this.logger.info("Resyncing state after HA reconnect");
    try {
      if (this.eventSubscription) {
        try {
          await this.eventSubscription.unsubscribe();
        } catch {
          // La suscripción anterior puede ser inválida (socket cerrado)
        }
        this.eventSubscription = undefined;
      }

      await this.haClient.getStates();

      if (
        this.config.subscribeOnConnect &&
        this.storedEventHandlers &&
        (this.storedEventHandlers.onEvent || this.storedEventHandlers.onStateChange)
      ) {
        this.eventSubscription = await this.subscribeToEventsUseCase.execute({
          onEvent: this.storedEventHandlers.onEvent,
          onStateChange: this.storedEventHandlers.onStateChange,
        });
      }
      this.logger.info("Resync after HA reconnect completed");
    } catch (error) {
      this.logger.error("Resync after HA reconnect failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Stop the agent and disconnect
   */
  async stop(): Promise<void> {
    this.logger.info("Stopping agent");

    // Unsubscribe from events
    if (this.eventSubscription) {
      await this.eventSubscription.unsubscribe();
    }

    // Disconnect from Home Assistant
    await this.haClient.disconnect();

    this.logger.info("Agent stopped");
  }

  /**
   * Call a Home Assistant service
   */
  async callService(
    domain: string,
    service: string,
    entityId?: string | string[],
    data?: Record<string, unknown>
  ): Promise<{ success: boolean; message: string }> {
    return this.callServiceUseCase.execute({
      domain,
      service,
      entityId,
      data,
    });
  }

  /**
   * Get entity state(s)
   */
  async getState(entityId?: string): Promise<EntityState[]> {
    const result = await this.getEntityStateUseCase.execute({ entityId });
    return result.entities;
  }

  /**
   * Get entities by domain
   */
  async getEntitiesByDomain(domain: string): Promise<EntityState[]> {
    const result = await this.getEntityStateUseCase.execute({
      filter: { domain },
    });
    return result.entities;
  }

  /**
   * Process a conversation/command
   */
  async processConversation(
    text: string,
    conversationId?: string
  ): Promise<{ speech: string; conversationId: string }> {
    const result = await this.processConversationUseCase.execute({
      text,
      conversationId,
    });
    return {
      speech: result.response.speech,
      conversationId: result.conversationId,
    };
  }

  // Convenience methods for common actions

  /**
   * Turn on a light
   */
  async turnOnLight(entityId: string, brightness?: number): Promise<void> {
    await this.callService(
      "light",
      "turn_on",
      entityId,
      brightness ? { brightness } : undefined
    );
  }

  /**
   * Turn off a light
   */
  async turnOffLight(entityId: string): Promise<void> {
    await this.callService("light", "turn_off", entityId);
  }

  /**
   * Toggle a light
   */
  async toggleLight(entityId: string): Promise<void> {
    await this.callService("light", "toggle", entityId);
  }

  /**
   * Turn on a switch
   */
  async turnOnSwitch(entityId: string): Promise<void> {
    await this.callService("switch", "turn_on", entityId);
  }

  /**
   * Turn off a switch
   */
  async turnOffSwitch(entityId: string): Promise<void> {
    await this.callService("switch", "turn_off", entityId);
  }

  /**
   * Set climate temperature
   */
  async setTemperature(entityId: string, temperature: number): Promise<void> {
    await this.callService("climate", "set_temperature", entityId, {
      temperature,
    });
  }

  /**
   * Run a script
   */
  async runScript(entityId: string): Promise<void> {
    await this.callService("script", "turn_on", entityId);
  }

  /**
   * Activate a scene
   */
  async activateScene(entityId: string): Promise<void> {
    await this.callService("scene", "turn_on", entityId);
  }

  // ============================================================
  // Mapped Data Methods - Returns data ready for database
  // ============================================================

  /**
   * Get all devices mapped to readable format
   */
  async getDevices(filter?: DeviceFilter): Promise<DeviceSummary[]> {
    const result = await this.getDevicesUseCase.execute({ filter });
    return result.devices as DeviceSummary[];
  }

  /**
   * Get all devices with full details
   */
  async getDevicesWithDetails(filter?: DeviceFilter): Promise<Device[]> {
    const result = await this.getDevicesUseCase.execute({
      filter,
      includeFullDetails: true,
    });
    return result.devices as Device[];
  }

  /**
   * Get devices by type (light, switch, sensor, etc.)
   */
  async getDevicesByType(type: DeviceType): Promise<DeviceSummary[]> {
    return this.getDevices({ type });
  }

  /**
   * Get devices by room
   */
  async getDevicesByRoom(roomId: string): Promise<DeviceSummary[]> {
    return this.getDevices({ roomId });
  }

  /**
   * Get online devices only
   */
  async getOnlineDevices(): Promise<DeviceSummary[]> {
    return this.getDevices({ isOnline: true });
  }

  /**
   * Get devices that are currently on
   */
  async getActiveDevices(): Promise<DeviceSummary[]> {
    return this.getDevices({ isOn: true });
  }

  /**
   * Search devices by name
   */
  async searchDevices(query: string): Promise<DeviceSummary[]> {
    return this.getDevices({ search: query });
  }

  /**
   * Get device stats
   */
  async getDeviceStats(): Promise<{
    total: number;
    online: number;
    on: number;
  }> {
    const result = await this.getDevicesUseCase.execute({});
    return {
      total: result.count,
      online: result.onlineCount,
      on: result.onCount,
    };
  }

  /**
   * Get all rooms mapped to readable format
   */
  async getRooms(): Promise<Room[]> {
    const result = await this.getRoomsUseCase.execute({});
    return result.rooms as Room[];
  }

  /**
   * Get all rooms with their devices
   */
  async getRoomsWithDevices(): Promise<RoomWithDevices[]> {
    const result = await this.getRoomsUseCase.execute({ includeDevices: true });
    return result.rooms as RoomWithDevices[];
  }

  /**
   * Get a specific room with its devices
   */
  async getRoom(roomId: string): Promise<RoomWithDevices | null> {
    return this.getRoomsUseCase.getRoomWithDevices(roomId);
  }

  /**
   * Get complete home overview with floors, rooms, and stats
   */
  async getHomeOverview(): Promise<HomeOverview> {
    const result = await this.getRoomsUseCase.getHomeOverview();
    return result.overview;
  }

  /**
   * Get all data for database sync (devices + rooms + overview)
   */
  async getAllMappedData(): Promise<{
    devices: Device[];
    rooms: Room[];
    overview: HomeOverview;
  }> {
    const [devicesResult, roomsResult, overviewResult] = await Promise.all([
      this.getDevicesUseCase.execute({ includeFullDetails: true }),
      this.getRoomsUseCase.execute({}),
      this.getRoomsUseCase.getHomeOverview(),
    ]);

    return {
      devices: devicesResult.devices as Device[],
      rooms: roomsResult.rooms as Room[],
      overview: overviewResult.overview,
    };
  }

  // ============================================================
  // Cloud Sync Methods
  // ============================================================

  /**
   * Sync devices to cloud
   * Fetches devices from HA, transforms them to cloud format, and emits to cloud
   * After successful sync, starts watching for real-time state changes and listening for cloud updates
   */
  async syncDevicesToCloud(homeId: string): Promise<{
    success: boolean;
    syncedDevices: number;
    watching: boolean;
    error?: string;
  }> {
    this.logger.info("syncDevicesToCloud called", {
      homeId,
      hasCloudClient: !!this.config.cloudClient,
      cloudClientState: this.config.cloudClient?.connectionState,
    });

    if (!this.config.cloudClient) {
      this.logger.warn("Cloud client not configured for sync");
      return {
        success: false,
        syncedDevices: 0,
        watching: false,
        error: "Cloud client not configured",
      };
    }

    if (this.config.cloudClient.connectionState !== "connected") {
      this.logger.warn("Cloud client not connected", {
        state: this.config.cloudClient.connectionState,
      });
      return {
        success: false,
        syncedDevices: 0,
        watching: false,
        error: `Cloud client not connected (state: ${this.config.cloudClient.connectionState})`,
      };
    }

    try {
      const syncUseCase = new SyncDevicesToCloud(
        this.haClient,
        this.config.cloudClient,
        this.logger
      );

      const result = await syncUseCase.execute({ homeId });

      // If sync was successful, initialize the capability sync manager
      if (result.success && result.haDevices && result.syncedDevices_info) {
        this.initializeCapabilitySyncManager(
          homeId,
          result.syncedDevices_info,
          result.haDevices
        );
      }

      return {
        success: result.success,
        syncedDevices: result.syncedDevices,
        watching: this.capabilitySyncManager?.active ?? false,
        error: result.error ?? result.response?.error,
      };
    } catch (error) {
      this.logger.error("syncDevicesToCloud failed", error);
      return {
        success: false,
        syncedDevices: 0,
        watching: false,
        error: error instanceof Error ? error.message : "Unknown sync error",
      };
    }
  }

  /**
   * Initialize the capability sync manager after a successful sync
   * This handles bidirectional sync: HA -> Cloud and Cloud -> HA
   */
  private initializeCapabilitySyncManager(
    homeId: string,
    syncedDevices: import("../domain/entities/CloudDevice.js").SyncedDeviceInfo[],
    haDevices: import("../domain/entities/CloudDevice.js").CloudDevice[]
  ): void {
    if (!this.config.cloudClient) {
      return;
    }

    // Stop existing manager if any
    if (this.capabilitySyncManager) {
      this.capabilitySyncManager.reset();
    }

    // Create new capability sync manager
    this.capabilitySyncManager = new CapabilitySyncManager(
      this.haClient,
      this.config.cloudClient,
      this.logger,
      {
        dumioDeviceId: this.config.dumioDeviceId ?? this.config.name,
        autoRestoreOnReconnect: true,
      }
    );

    // Initialize with synced devices (includes Dumio UUIDs) and HA devices (for controller)
    this.capabilitySyncManager.initializeFromSync(
      homeId,
      syncedDevices,
      haDevices
    );

    const stats = this.capabilitySyncManager.getStats();
    this.logger.info("CapabilitySyncManager initialized after sync", {
      homeId,
      watchingEntities: stats.watcherStats?.updatesSent ?? 0,
      controllableDevices: stats.controllerMappings,
    });
  }

  /**
   * Get the capability sync manager for external access
   */
  getCapabilitySyncManager(): CapabilitySyncManager | undefined {
    return this.capabilitySyncManager;
  }

  /**
   * Attempt to restore sync state from cloud (called after reconnection)
   */
  async restoreSyncFromCloud(): Promise<boolean> {
    if (!this.capabilitySyncManager) {
      this.logger.warn("Cannot restore sync: no sync manager initialized");
      return false;
    }

    return this.capabilitySyncManager.restoreSyncStateFromCloud();
  }

  /**
   * Stop the capability sync manager
   */
  stopCapabilitySyncManager(): void {
    if (this.capabilitySyncManager) {
      this.capabilitySyncManager.reset();
      this.capabilitySyncManager = undefined;
      this.logger.info("CapabilitySyncManager stopped");
    }
  }

  /**
   * Check if capability sync manager is active
   */
  isCapabilitySyncActive(): boolean {
    return this.capabilitySyncManager?.active ?? false;
  }

  /**
   * Control a device (execute a command from cloud)
   */
  async controlDevice(
    command: DeviceControlCommand
  ): Promise<DeviceControlResponse> {
    const controller = this.capabilitySyncManager?.controller;

    if (!controller) {
      this.logger.warn("Device controller not initialized. Run sync first.");
      return {
        success: false,
        deviceId: command.deviceId,
        message: "Device controller not initialized",
        error: "Run devices sync first to initialize device mappings",
      };
    }

    return controller.execute(command);
  }

  /**
   * Check if device controller is ready
   */
  isDeviceControllerReady(): boolean {
    return (this.capabilitySyncManager?.controller?.mappingCount ?? 0) > 0;
  }

  /**
   * Get sync statistics
   */
  getSyncStats(): {
    isActive: boolean;
    homeId: string | null;
    deviceCount: number;
    watcherStats: {
      eventsReceived: number;
      updatesSkipped: number;
      updatesSent: number;
      updatesFailed: number;
    } | null;
    controllerMappings: number;
  } | null {
    if (!this.capabilitySyncManager) {
      return null;
    }
    return this.capabilitySyncManager.getStats();
  }
}
