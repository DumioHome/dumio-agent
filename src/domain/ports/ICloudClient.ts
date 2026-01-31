/**
 * Cloud connection state
 */
export type CloudConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Agent health data to send to cloud
 */
export interface AgentHealthData {
  /** Unique device identifier (dumio-{random}) */
  dumioDeviceId: string;
  /** Current status of Home Assistant connection */
  status: 'online' | 'offline' | 'connecting' | 'error';
  /** Timestamp of the health update */
  timestamp: string;
  /** Home Assistant connection details */
  homeAssistant: {
    connected: boolean;
    version?: string;
    entityCount: number;
    deviceCount: number;
  };
  /** Agent metadata */
  agent: {
    name: string;
    version: string;
    uptime: number;
  };
}

/**
 * Cloud event types
 */
export interface CloudEventMap {
  'health:request': void;
  'command:execute': { command: string; params?: Record<string, unknown> };
  'devices:request': { filter?: Record<string, unknown> };
  'rooms:request': void;
}

/**
 * Cloud response types
 */
export interface CloudResponseMap {
  'health:update': AgentHealthData;
  'devices:response': unknown[];
  'rooms:response': unknown[];
  'command:result': { success: boolean; message: string; data?: unknown };
}

/**
 * Interface for cloud client communication
 */
export interface ICloudClient {
  /**
   * Current connection state
   */
  readonly connectionState: CloudConnectionState;

  /**
   * Connect to the cloud server
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the cloud server
   */
  disconnect(): Promise<void>;

  /**
   * Send health data to the cloud
   */
  sendHealth(data: AgentHealthData): void;

  /**
   * Send a generic event to the cloud
   */
  emit<K extends keyof CloudResponseMap>(event: K, data: CloudResponseMap[K]): void;

  /**
   * Register handler for incoming cloud events
   */
  on<K extends keyof CloudEventMap>(event: K, handler: (data: CloudEventMap[K]) => void): void;

  /**
   * Remove handler for incoming cloud events
   */
  off<K extends keyof CloudEventMap>(event: K, handler: (data: CloudEventMap[K]) => void): void;

  /**
   * Register handler for connection state changes
   */
  onConnectionStateChange(handler: (state: CloudConnectionState) => void): void;
}
