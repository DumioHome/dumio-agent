import type {
  DevicesSyncPayload,
  DevicesSyncCallbackResponse,
  CapabilityUpdatePayload,
  CapabilityUpdateResponse,
  DeviceControlCommand,
  DeviceControlResponse,
  DevicesFetchRequest,
  DevicesFetchResponse,
  CapabilitiesUpdatedPayload,
} from "../entities/CloudDevice.js";

/**
 * Cloud connection state
 */
export type CloudConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/**
 * Agent health data to send to cloud
 */
export interface AgentHealthData {
  /** Unique device identifier (dumio-{random}) */
  dumioDeviceId: string;
  /** Current status of Home Assistant connection */
  status: "online" | "offline" | "connecting" | "error";
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
 * Cloud event types (events received FROM cloud)
 */
export interface CloudEventMap {
  "health:request": void;
  "command:execute": { command: string; params?: Record<string, unknown> };
  "devices:request": { filter?: Record<string, unknown> };
  "rooms:request": void;
  /** Control a device (turn on/off, set brightness, etc.) */
  "device:control": DeviceControlCommand;
  /** Capabilities updated from cloud (sent when capabilities change externally) */
  "capabilities:updated": CapabilitiesUpdatedPayload;
}

/**
 * Cloud response types (events sent TO cloud without callback)
 */
export interface CloudResponseMap {
  "health:update": AgentHealthData;
  "devices:response": unknown[];
  "rooms:response": unknown[];
  "command:result": { success: boolean; message: string; data?: unknown };
  /** Response to device control command */
  "device:control:response": DeviceControlResponse;
  /** Real-time capability state update (fire-and-forget) */
  "capability:update": CapabilityUpdatePayload;
}

/**
 * Cloud emit with callback types
 */
export interface CloudEmitWithCallbackMap {
  "devices:sync": {
    payload: DevicesSyncPayload;
    response: DevicesSyncCallbackResponse;
  };
  /** Fetch devices from cloud (used after reconnection) */
  "devices:fetch": {
    payload: DevicesFetchRequest;
    response: DevicesFetchResponse;
  };
  /** Real-time capability state update (with callback) */
  "capability:update": {
    payload: CapabilityUpdatePayload;
    response: CapabilityUpdateResponse;
  };
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
  emit<K extends keyof CloudResponseMap>(
    event: K,
    data: CloudResponseMap[K]
  ): void;

  /**
   * Send an event with callback to receive response from cloud
   */
  emitWithCallback<K extends keyof CloudEmitWithCallbackMap>(
    event: K,
    data: CloudEmitWithCallbackMap[K]["payload"],
    timeout?: number
  ): Promise<CloudEmitWithCallbackMap[K]["response"]>;

  /**
   * Register handler for incoming cloud events
   */
  on<K extends keyof CloudEventMap>(
    event: K,
    handler: (data: CloudEventMap[K]) => void
  ): void;

  /**
   * Remove handler for incoming cloud events
   */
  off<K extends keyof CloudEventMap>(
    event: K,
    handler: (data: CloudEventMap[K]) => void
  ): void;

  /**
   * Register handler for connection state changes
   */
  onConnectionStateChange(handler: (state: CloudConnectionState) => void): void;
}
