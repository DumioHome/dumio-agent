/**
 * Cloud device capability types
 */
export type CloudCapabilityType =
  | 'switch'
  | 'brightness'
  | 'color_temp'
  | 'color'
  | 'temperature'
  | 'humidity'
  | 'battery'
  | 'power'
  | 'energy'
  | 'position'
  | 'volume'
  | 'media_control'
  | 'mode'
  | 'preset'
  | 'motion'
  | 'door'
  | 'window'
  | 'lock'
  | 'sensor'; // Generic sensor without specific type

/**
 * Cloud capability value types
 */
export type CloudValueType = 'boolean' | 'number' | 'string' | 'object';

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
 * Cloud device type mapping - matches domain DeviceType
 */
export type CloudDeviceType =
  | 'light'
  | 'switch'
  | 'sensor'
  | 'binary_sensor'
  | 'climate'
  | 'cover'
  | 'fan'
  | 'media_player'
  | 'camera'
  | 'lock'
  | 'vacuum'
  | 'speaker'
  | 'tv'
  | 'thermostat'
  | 'door'
  | 'window'
  | 'motion'
  | 'temperature'
  | 'humidity'
  | 'power'
  | 'battery'
  | 'unknown';

/**
 * Cloud device format for sync
 * Represents a physical device that may have multiple entities/capabilities
 */
export interface CloudDevice {
  /** Home Assistant device ID (physical device identifier) */
  deviceId: string;
  /** All entity IDs associated with this physical device */
  entityIds: string[];
  /** Primary device type category (most relevant type from entities) */
  deviceType: CloudDeviceType;
  /** Device friendly name */
  name: string;
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
 * Devices sync response callback data
 */
export interface DevicesSyncCallbackResponse {
  success: boolean;
  data?: {
    devices: Array<{ id: string; deviceType: string; name: string }>;
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
 */
export interface CapabilityUpdatePayload {
  /** Physical device ID */
  deviceId: string;
  /** Entity ID that changed */
  entityId: string;
  /** Type of capability that changed */
  capabilityType: CloudCapabilityType;
  /** New value */
  currentValue: CloudCapabilityValue;
  /** Timestamp of the change */
  timestamp: string;
}
