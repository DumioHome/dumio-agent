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
  | 'lock';

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
 */
export interface CloudDevice {
  /** Home Assistant entity ID for reference */
  entityId: string;
  /** Device type category */
  deviceType: CloudDeviceType;
  /** Device friendly name */
  name: string;
  /** Device model */
  model: string | null;
  /** Device manufacturer */
  manufacturer: string | null;
  /** Room/area name */
  roomName: string | null;
  /** Device capabilities array */
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
