/**
 * Device type categories
 */
export type DeviceType =
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
 * Device status - simplified and readable
 */
export interface DeviceStatus {
  isOnline: boolean;
  isOn: boolean | null; // null for sensors
  state: string;
  stateDisplay: string; // Human readable state
  lastChanged: Date;
  lastUpdated: Date;
  attributes: DeviceAttributes;
}

/**
 * Common device attributes mapped to readable format
 */
export interface DeviceAttributes {
  brightness?: number; // 0-100 percentage
  colorTemp?: number; // Kelvin
  color?: {
    r: number;
    g: number;
    b: number;
  };
  temperature?: number;
  humidity?: number;
  battery?: number; // 0-100 percentage
  power?: number; // Watts
  energy?: number; // kWh
  position?: number; // 0-100 for covers
  volume?: number; // 0-100
  mediaTitle?: string;
  mediaArtist?: string;
  source?: string;
  mode?: string;
  preset?: string;
  targetTemperature?: number;
  currentTemperature?: number;
  unit?: string;
  [key: string]: unknown;
}

/**
 * Mapped device model for database
 */
export interface Device {
  id: string;
  entityId: string;
  name: string;
  type: DeviceType;
  roomId: string | null;
  roomName: string | null;
  manufacturer: string | null;
  model: string | null;
  swVersion: string | null;
  /** Integration/platform that provides this device (tuya, zha, mqtt, etc.) */
  integration: string | null;
  status: DeviceStatus;
  capabilities: DeviceCapabilities;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Device capabilities
 */
export interface DeviceCapabilities {
  canTurnOn: boolean;
  canTurnOff: boolean;
  canToggle: boolean;
  canDim: boolean;
  canChangeColor: boolean;
  canChangeTemperature: boolean;
  canSetPosition: boolean;
  canSetVolume: boolean;
  supportedFeatures: string[];
}

/**
 * Device summary for lists
 */
export interface DeviceSummary {
  id: string;
  name: string;
  type: DeviceType;
  roomName: string | null;
  isOnline: boolean;
  isOn: boolean | null;
  stateDisplay: string;
}

/**
 * Device filter criteria
 */
export interface DeviceFilter {
  roomId?: string;
  type?: DeviceType;
  types?: DeviceType[];
  isOnline?: boolean;
  isOn?: boolean;
  search?: string;
  /** Only include devices with a real device_id (physical devices) - default: true */
  onlyPhysical?: boolean;
  /** Include all entities, even system ones - default: false */
  includeAll?: boolean;
  /** Filter by manufacturer (tuya, xiaomi, philips, etc.) */
  manufacturer?: string;
  /** Filter by integration/platform (tuya, zha, mqtt, hue, etc.) */
  integration?: string;
  /** Filter by multiple integrations */
  integrations?: string[];
}

/**
 * Allowed IoT integrations - ONLY these will be returned by default
 * Add or remove integrations based on what you actually use
 */
export const ALLOWED_IOT_INTEGRATIONS = [
  // Smart Home Platforms
  'tuya',
  'smart_life',
  'smartlife',
  
  // Zigbee
  'zha',
  'zigbee2mqtt',
  'deconz',
  
  // Z-Wave
  'zwave',
  'zwave_js',
  
  // WiFi devices
  'xiaomi_miio',
  'yeelight',
  'tplink',
  'tapo',
  'shelly',
  'esphome',
  'tasmota',
  'sonoff',
  'wled',
  'wiz',
  'lifx',
  
  // Major brands
  'hue',
  'ikea',
  'nanoleaf',
  'govee',
  
  // Generic protocols
  'mqtt',
  'modbus',
  
  // Cameras & Security
  'ring',
  'nest',
  'eufy',
  'reolink',
  'hikvision',
  
  // Climate
  'sensibo',
  'tado',
  'ecobee',
  'honeywell',
  
  // Media
  'cast',
  'google_cast',
  'sonos',
  'spotify',
  'samsung_tv',
  'lg_tv',
  'roku',
  'apple_tv',
] as const;

export type AllowedIntegration = typeof ALLOWED_IOT_INTEGRATIONS[number];

/**
 * Domains that are typically NOT physical devices
 */
export const EXCLUDED_DOMAINS = [
  'automation',
  'script',
  'scene',
  'group',
  'input_boolean',
  'input_number',
  'input_text',
  'input_select',
  'input_datetime',
  'input_button',
  'counter',
  'timer',
  'schedule',
  'zone',
  'person',
  'sun',
  'weather',
  'persistent_notification',
  'conversation',
  'stt',
  'tts',
  'wake_word',
  'update',
  'button', // Usually virtual buttons
  'number', // Usually config entities
  'select', // Usually config entities
  'text',   // Usually config entities
  'event',
  'calendar',
  'todo',
  'image',
  'device_tracker', // Can be included if needed
] as const;

/**
 * Domains that are typically physical/real devices
 */
export const PHYSICAL_DEVICE_DOMAINS = [
  'light',
  'switch',
  'sensor',
  'binary_sensor',
  'climate',
  'cover',
  'fan',
  'media_player',
  'camera',
  'lock',
  'vacuum',
  'humidifier',
  'water_heater',
  'alarm_control_panel',
  'remote',
  'siren',
  'valve',
] as const;
