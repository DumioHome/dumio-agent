import type { IHomeAssistantClient, ConnectionState } from '../domain/ports/IHomeAssistantClient.js';
import type { ILogger } from '../domain/ports/ILogger.js';
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
} from '../domain/index.js';
import {
  ConnectToHomeAssistant,
  CallService,
  GetEntityState,
  ProcessConversation,
  SubscribeToEvents,
  GetDevices,
  GetRooms,
} from '../application/index.js';

export interface AgentConfig {
  name: string;
  autoReconnect?: boolean;
  subscribeOnConnect?: boolean;
}

export interface AgentEventHandlers {
  onStateChange?: (entityId: string, oldState: EntityState | null, newState: EntityState) => void;
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

    this.logger.info('Agent initialized', { name: config.name });
  }

  /**
   * Start the agent and connect to Home Assistant
   */
  async start(handlers?: AgentEventHandlers): Promise<void> {
    this.logger.info('Starting agent', { name: this.config.name });

    // Register connection state handler
    if (handlers?.onConnectionChange) {
      this.haClient.onConnectionStateChange(handlers.onConnectionChange);
    }

    // Connect to Home Assistant
    const connectResult = await this.connectUseCase.execute({
      subscribeToStateChanges: this.config.subscribeOnConnect,
    });

    this.logger.info('Connected to Home Assistant', {
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

    this.logger.info('Agent started successfully');
  }

  /**
   * Stop the agent and disconnect
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping agent');

    // Unsubscribe from events
    if (this.eventSubscription) {
      await this.eventSubscription.unsubscribe();
    }

    // Disconnect from Home Assistant
    await this.haClient.disconnect();

    this.logger.info('Agent stopped');
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
    await this.callService('light', 'turn_on', entityId, brightness ? { brightness } : undefined);
  }

  /**
   * Turn off a light
   */
  async turnOffLight(entityId: string): Promise<void> {
    await this.callService('light', 'turn_off', entityId);
  }

  /**
   * Toggle a light
   */
  async toggleLight(entityId: string): Promise<void> {
    await this.callService('light', 'toggle', entityId);
  }

  /**
   * Turn on a switch
   */
  async turnOnSwitch(entityId: string): Promise<void> {
    await this.callService('switch', 'turn_on', entityId);
  }

  /**
   * Turn off a switch
   */
  async turnOffSwitch(entityId: string): Promise<void> {
    await this.callService('switch', 'turn_off', entityId);
  }

  /**
   * Set climate temperature
   */
  async setTemperature(entityId: string, temperature: number): Promise<void> {
    await this.callService('climate', 'set_temperature', entityId, { temperature });
  }

  /**
   * Run a script
   */
  async runScript(entityId: string): Promise<void> {
    await this.callService('script', 'turn_on', entityId);
  }

  /**
   * Activate a scene
   */
  async activateScene(entityId: string): Promise<void> {
    await this.callService('scene', 'turn_on', entityId);
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
  async getDeviceStats(): Promise<{ total: number; online: number; on: number }> {
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
}
