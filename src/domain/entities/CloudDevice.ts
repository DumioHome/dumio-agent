/**
 * Cloud device capability types
 */
export type CloudCapabilityType =
  | "switch"
  | "brightness"
  | "color_temp"
  | "color"
  | "temperature"
  | "humidity"
  | "battery"
  | "power"
  | "energy"
  | "position"
  | "volume"
  | "media_control"
  | "mode"
  | "preset"
  | "motion"
  | "door"
  | "window"
  | "lock"
  | "sensor"; // Generic sensor without specific type

/**
 * Cloud capability value types
 */
export type CloudValueType = "boolean" | "number" | "string" | "object";

/**
 * Cloud capability current value - varies by capability type
 */
export interface CloudCapabilityValue {
  on?: boolean;
  value?: number | string;
  r?: number;
  g?: number;
  b?: number;
}

/**
 * Cloud capability metadata
 */
export interface CloudCapabilityMeta {
  min?: number;
  max?: number;
  unit?: string;
  description?: string;
  options?: string[];
}

/**
 * Cloud device capability format
 */
export interface CloudCapability {
  capabilityType: CloudCapabilityType;
  valueType: CloudValueType;
  currentValue: CloudCapabilityValue;
  meta: CloudCapabilityMeta | null;
}

/**
 * Cloud device type mapping - high level Dumio classifications.
 * Derived from all entities of a physical device (switch + sensor => dumio_smart_switch, etc.).
 */
export type CloudDeviceType =
  | "dumio_ac"
  | "dumio_light"
  | "dumio_switch"
  | "dumio_smart_switch"
  | "dumio_sensor"
  | "dumio_generic_switch"
  | "dumio_generic_sensor";

/**
 * Cloud device format for sync
 * Represents a physical device that may have multiple entities/capabilities
 * Note: name field removed - device names are managed via GraphQL mutations
 */
export interface CloudDevice {
  /** Home Assistant device ID (physical device identifier) */
  deviceId: string;
  /** All entity IDs associated with this physical device */
  entityIds: string[];
  /** Primary device type category (most relevant type from entities) */
  deviceType: CloudDeviceType;
  /** Device model */
  model: string | null;
  /** Device manufacturer */
  manufacturer: string | null;
  /** Room/area name */
  roomName: string | null;
  /** Integration/platform (tuya, zha, mqtt, etc.) */
  integration: string | null;
  /** Device capabilities array (combined from all entities) */
  capabilities: CloudCapability[];
}

/**
 * Devices sync request from cloud
 */
export interface DevicesSyncRequest {
  homeId: string;
}

/**
 * Synced device info returned from cloud
 */
export interface SyncedDeviceInfo {
  /** UUID de Dumio - usar este para capability:update */
  id: string;
  /** deviceId de HA que enviaste */
  deviceId: string;
  /** entityIds que enviaste */
  entityIds: string[];
  deviceType: string;
  name: string;
  model: string | null;
  manufacturer: string | null;
  capabilities: Array<{
    id: string;
    capabilityType: CloudCapabilityType;
    valueType: CloudValueType;
    currentValue: boolean | number | string | null;
    meta: CloudCapabilityMeta | null;
  }>;
  /** true si se creó, false si se actualizó */
  isNew: boolean;
}

/**
 * Devices sync response callback data
 */
export interface DevicesSyncCallbackResponse {
  success: boolean;
  data?: {
    homeId: string;
    summary: {
      total: number;
      created: number;
      updated: number;
      skipped: number;
    };
    devices: SyncedDeviceInfo[];
  };
  error?: string;
}

/**
 * Devices sync payload to emit
 */
export interface DevicesSyncPayload {
  homeId: string;
  devices: CloudDevice[];
}

/**
 * Capability update payload for real-time state changes
 * Sent to cloud when a device capability changes in HA
 */
export interface CapabilityUpdatePayload {
  /** UUID de Dumio del device (NOT the HA deviceId) */
  deviceId: string;
  /** Type of capability that changed */
  capabilityType: CloudCapabilityType;
  /** New value wrapped in object: { on: true }, { value: 75 }, { r, g, b }, etc. */
  currentValue: CloudCapabilityValue;
}

/**
 * Capability update response from cloud
 */
export interface CapabilityUpdateResponse {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Device control command from cloud
 */
export interface DeviceControlCommand {
  /** Physical device ID or entity ID */
  deviceId: string;
  /** Optional: specific entity to control (if device has multiple) */
  entityId?: string;
  /** Type of capability to control */
  capabilityType: CloudCapabilityType;
  /** Value to set */
  value: CloudCapabilityValue;
}

/**
 * Device control response
 */
export interface DeviceControlResponse {
  success: boolean;
  deviceId: string;
  entityId?: string;
  message: string;
  error?: string;
}

/**
 * Request to fetch devices from cloud (used after reconnection)
 */
export interface DevicesFetchRequest {
  /** Dumio Device ID to identify the agent */
  dumioDeviceId: string;
}

/**
 * Response from cloud when fetching devices
 */
export interface DevicesFetchResponse {
  success: boolean;
  /** Home ID associated with this agent */
  homeId?: string;
  /** Devices stored in cloud for this home */
  devices?: Array<{
    deviceId: string;
    entityIds: string[];
    deviceType: CloudDeviceType;
    name: string;
  }>;
  error?: string;
}

/**
 * Capabilities updated event from cloud
 * Sent when capabilities are updated externally (e.g., from another agent or app)
 */
export interface CapabilitiesUpdatedPayload {
  /** Device ID that was updated */
  deviceId: string;
  /** Entity ID that was updated */
  entityId: string;
  /** Type of capability that changed */
  capabilityType: CloudCapabilityType;
  /** New value to apply */
  value: CloudCapabilityValue;
  /** Source of the update (for filtering out own updates) */
  source?: "cloud" | "app" | "agent";
  /** Timestamp of the update */
  timestamp: string;
}
