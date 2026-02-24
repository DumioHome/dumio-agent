import type { EntityState } from '../../domain/entities/Entity.js';
import type {
  Device,
  DeviceType,
  DeviceStatus,
  DeviceAttributes,
  DeviceCapabilities,
  DeviceSummary,
} from '../../domain/entities/Device.js';

/**
 * Home Assistant device entry type.
 * - null/undefined: device from integration (physical or from config entry)
 * - 'service': device created from UI (helper) - virtual, not a physical device
 */
export type HADeviceEntryType = null | 'service';

/**
 * Raw device info from Home Assistant device registry (WebSocket config/device_registry/list)
 */
export interface HADeviceInfo {
  id: string;
  name: string;
  name_by_user?: string;
  manufacturer?: string;
  model?: string;
  sw_version?: string;
  area_id?: string;
  disabled_by?: string;
  /** 'service' = helper/virtual device; null/undefined = from integration */
  entry_type?: HADeviceEntryType | string;
  /** Identifiers contain [integration, device_id] tuples. Required for real devices. */
  identifiers?: Array<[string, string]>;
  /** Connections like MAC addresses */
  connections?: Array<[string, string]>;
  /** Config entry ID */
  config_entries?: string[];
  /** Via device (hub/bridge) */
  via_device_id?: string;
}

/**
 * Raw area info from Home Assistant area registry
 */
export interface HAAreaInfo {
  area_id: string;
  name: string;
  picture?: string;
  floor_id?: string;
  icon?: string;
}

/**
 * Maps Home Assistant data to Device model
 */
export class DeviceMapper {
  /**
   * Map entity domain to device type.
   * For official Dumio domain (dumio_plug), infers type from entity name suffix or device_class.
   */
  static mapDomainToType(
    domain: string,
    attributes: Record<string, unknown>,
    entityId?: string
  ): DeviceType {
    const deviceClass = attributes.device_class as string | undefined;

    // Check device_class first for more specific types
    if (deviceClass) {
      const classMap: Record<string, DeviceType> = {
        door: 'door',
        window: 'window',
        motion: 'motion',
        temperature: 'temperature',
        humidity: 'humidity',
        power: 'power',
        battery: 'battery',
        tv: 'tv',
        speaker: 'speaker',
      };
      if (classMap[deviceClass]) {
        return classMap[deviceClass];
      }
    }

    // Official Dumio devices: domain dumio_plug — infer type from entity name suffix
    if (domain === 'dumio_plug' && entityId) {
      const name = entityId.split('.')[1]?.toLowerCase() ?? '';
      if (name.includes('light')) return 'light';
      if (name.includes('switch')) return 'switch';
      if (name.includes('temperature')) return 'temperature';
      if (name.includes('humidity')) return 'humidity';
      if (name.includes('sensor')) return 'sensor';
      if (name.includes('plug')) return 'switch';
    }

    // Map by domain
    const domainMap: Record<string, DeviceType> = {
      light: 'light',
      switch: 'switch',
      sensor: 'sensor',
      binary_sensor: 'binary_sensor',
      climate: 'climate',
      cover: 'cover',
      fan: 'fan',
      media_player: 'media_player',
      camera: 'camera',
      lock: 'lock',
      vacuum: 'vacuum',
    };

    return domainMap[domain] ?? 'unknown';
  }

  /**
   * Map state string to readable display
   */
  static mapStateToDisplay(state: string, type: DeviceType, attributes: Record<string, unknown>): string {
    const stateMap: Record<string, string> = {
      on: 'Encendido',
      off: 'Apagado',
      unavailable: 'No disponible',
      unknown: 'Desconocido',
      home: 'En casa',
      not_home: 'Fuera',
      playing: 'Reproduciendo',
      paused: 'Pausado',
      idle: 'Inactivo',
      standby: 'En espera',
      open: 'Abierto',
      closed: 'Cerrado',
      opening: 'Abriendo',
      closing: 'Cerrando',
      locked: 'Bloqueado',
      unlocked: 'Desbloqueado',
      cleaning: 'Limpiando',
      docked: 'En base',
      returning: 'Regresando',
      heat: 'Calentando',
      cool: 'Enfriando',
      heat_cool: 'Auto',
      dry: 'Secando',
      fan_only: 'Ventilador',
    };

    // For sensors, return the state with unit
    if (type === 'sensor' || type === 'temperature' || type === 'humidity' || type === 'power') {
      const unit = attributes.unit_of_measurement as string ?? '';
      return `${state}${unit ? ' ' + unit : ''}`;
    }

    return stateMap[state] ?? state;
  }

  /**
   * Check if device is considered online
   */
  static isOnline(state: string): boolean {
    return state !== 'unavailable' && state !== 'unknown';
  }

  /**
   * Check if device is on (for controllable devices)
   */
  static isOn(state: string, type: DeviceType): boolean | null {
    // Sensors don't have on/off state
    if (['sensor', 'binary_sensor', 'temperature', 'humidity', 'power', 'battery'].includes(type)) {
      if (type === 'binary_sensor') {
        return state === 'on';
      }
      return null;
    }

    const onStates = ['on', 'playing', 'open', 'unlocked', 'cleaning', 'heat', 'cool', 'heat_cool'];
    return onStates.includes(state);
  }

  /**
   * Map Home Assistant attributes to readable device attributes
   */
  static mapAttributes(attributes: Record<string, unknown>, _type: DeviceType): DeviceAttributes {
    const mapped: DeviceAttributes = {};

    // Brightness (0-255 to 0-100)
    if (attributes.brightness !== undefined) {
      mapped.brightness = Math.round((attributes.brightness as number) / 255 * 100);
    }

    // Color temperature
    if (attributes.color_temp_kelvin !== undefined) {
      mapped.colorTemp = attributes.color_temp_kelvin as number;
    } else if (attributes.color_temp !== undefined) {
      // Convert mireds to Kelvin
      mapped.colorTemp = Math.round(1000000 / (attributes.color_temp as number));
    }

    // RGB Color
    if (attributes.rgb_color !== undefined) {
      const rgb = attributes.rgb_color as number[];
      mapped.color = { r: rgb[0], g: rgb[1], b: rgb[2] };
    }

    // Temperature sensors
    if (attributes.temperature !== undefined) {
      mapped.temperature = attributes.temperature as number;
    }
    if (attributes.current_temperature !== undefined) {
      mapped.currentTemperature = attributes.current_temperature as number;
    }
    if (attributes.target_temp_high !== undefined || attributes.temperature !== undefined) {
      mapped.targetTemperature = (attributes.target_temp_high ?? attributes.temperature) as number;
    }

    // Humidity
    if (attributes.humidity !== undefined) {
      mapped.humidity = attributes.humidity as number;
    }
    if (attributes.current_humidity !== undefined) {
      mapped.humidity = attributes.current_humidity as number;
    }

    // Battery
    if (attributes.battery_level !== undefined) {
      mapped.battery = attributes.battery_level as number;
    } else if (attributes.battery !== undefined) {
      mapped.battery = attributes.battery as number;
    }

    // Power/Energy
    if (attributes.power !== undefined) {
      mapped.power = attributes.power as number;
    }
    if (attributes.energy !== undefined) {
      mapped.energy = attributes.energy as number;
    }

    // Position (covers)
    if (attributes.current_position !== undefined) {
      mapped.position = attributes.current_position as number;
    }

    // Volume
    if (attributes.volume_level !== undefined) {
      mapped.volume = Math.round((attributes.volume_level as number) * 100);
    }

    // Media
    if (attributes.media_title !== undefined) {
      mapped.mediaTitle = attributes.media_title as string;
    }
    if (attributes.media_artist !== undefined) {
      mapped.mediaArtist = attributes.media_artist as string;
    }
    if (attributes.source !== undefined) {
      mapped.source = attributes.source as string;
    }

    // Climate modes
    if (attributes.hvac_mode !== undefined) {
      mapped.mode = attributes.hvac_mode as string;
    }
    if (attributes.preset_mode !== undefined) {
      mapped.preset = attributes.preset_mode as string;
    }

    // Unit of measurement
    if (attributes.unit_of_measurement !== undefined) {
      mapped.unit = attributes.unit_of_measurement as string;
    }

    return mapped;
  }

  /**
   * Determine device capabilities from attributes
   */
  static mapCapabilities(attributes: Record<string, unknown>, type: DeviceType): DeviceCapabilities {
    const supportedFeatures = attributes.supported_features as number ?? 0;
    const supportedColorModes = attributes.supported_color_modes as string[] ?? [];

    // Default capabilities based on type
    const controllable = !['sensor', 'binary_sensor', 'temperature', 'humidity', 'power', 'battery'].includes(type);

    return {
      canTurnOn: controllable,
      canTurnOff: controllable,
      canToggle: controllable,
      canDim: supportedColorModes.includes('brightness') || attributes.brightness !== undefined,
      canChangeColor: supportedColorModes.includes('rgb') || supportedColorModes.includes('hs') || supportedColorModes.includes('xy'),
      canChangeTemperature: type === 'climate' || type === 'thermostat',
      canSetPosition: type === 'cover',
      canSetVolume: type === 'media_player' || type === 'speaker' || type === 'tv',
      supportedFeatures: this.parseSupportedFeatures(supportedFeatures, type),
    };
  }

  /**
   * Parse supported features bitmask to readable list
   */
  private static parseSupportedFeatures(features: number, type: DeviceType): string[] {
    const result: string[] = [];

    // Light features
    if (type === 'light') {
      if (features & 1) result.push('brightness');
      if (features & 2) result.push('color_temp');
      if (features & 4) result.push('effect');
      if (features & 8) result.push('flash');
      if (features & 16) result.push('color');
      if (features & 32) result.push('transition');
    }

    // Cover features
    if (type === 'cover') {
      if (features & 1) result.push('open');
      if (features & 2) result.push('close');
      if (features & 4) result.push('set_position');
      if (features & 8) result.push('stop');
      if (features & 16) result.push('open_tilt');
      if (features & 32) result.push('close_tilt');
      if (features & 64) result.push('stop_tilt');
      if (features & 128) result.push('set_tilt_position');
    }

    // Climate features
    if (type === 'climate' || type === 'thermostat') {
      if (features & 1) result.push('target_temperature');
      if (features & 2) result.push('target_temperature_range');
      if (features & 4) result.push('target_humidity');
      if (features & 8) result.push('fan_mode');
      if (features & 16) result.push('preset_mode');
      if (features & 32) result.push('swing_mode');
      if (features & 64) result.push('aux_heat');
    }

    return result;
  }

  /**
   * Map a single entity state to Device model
   */
  /**
   * Extract integration name from device identifiers
   */
  static extractIntegration(deviceInfo?: HADeviceInfo): string | null {
    if (!deviceInfo) return null;

    // Try to get integration from identifiers (most reliable)
    if (deviceInfo.identifiers && deviceInfo.identifiers.length > 0) {
      // identifiers is an array of [integration, id] tuples
      const [integration] = deviceInfo.identifiers[0];
      return integration?.toLowerCase() ?? null;
    }

    // Fallback: try to infer from manufacturer name
    if (deviceInfo.manufacturer) {
      const mfr = deviceInfo.manufacturer.toLowerCase();
      if (mfr.includes('tuya') || mfr.includes('smart life')) return 'tuya';
      if (mfr.includes('xiaomi') || mfr.includes('aqara') || mfr.includes('mija')) return 'xiaomi_miio';
      if (mfr.includes('philips') && mfr.includes('hue')) return 'hue';
      if (mfr.includes('ikea')) return 'ikea';
      if (mfr.includes('shelly')) return 'shelly';
      if (mfr.includes('sonoff')) return 'sonoff';
      if (mfr.includes('tp-link') || mfr.includes('tplink')) return 'tplink';
      if (mfr.includes('yeelight')) return 'yeelight';
      if (mfr.includes('espressif') || mfr.includes('esphome')) return 'esphome';
    }

    return null;
  }

  static mapEntity(
    entity: EntityState,
    deviceInfo?: HADeviceInfo,
    areaInfo?: HAAreaInfo
  ): Device {
    const [domain] = entity.entity_id.split('.');
    const type = this.mapDomainToType(domain, entity.attributes, entity.entity_id);
    const now = new Date();

    const status: DeviceStatus = {
      isOnline: this.isOnline(entity.state),
      isOn: this.isOn(entity.state, type),
      state: entity.state,
      stateDisplay: this.mapStateToDisplay(entity.state, type, entity.attributes),
      lastChanged: new Date(entity.last_changed),
      lastUpdated: new Date(entity.last_updated),
      attributes: this.mapAttributes(entity.attributes, type),
    };

    const friendlyName = entity.attributes.friendly_name as string ?? entity.entity_id;
    const integration = this.extractIntegration(deviceInfo);

    return {
      id: deviceInfo?.id ?? entity.entity_id,
      entityId: entity.entity_id,
      // Prioritize entity's friendly_name as it's what users typically customize
      name: friendlyName,
      type,
      roomId: areaInfo?.area_id ?? deviceInfo?.area_id ?? null,
      roomName: areaInfo?.name ?? null,
      manufacturer: deviceInfo?.manufacturer ?? null,
      model: deviceInfo?.model ?? null,
      swVersion: deviceInfo?.sw_version ?? null,
      integration,
      status,
      capabilities: this.mapCapabilities(entity.attributes, type),
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Map entity to summary
   */
  static mapToSummary(device: Device): DeviceSummary {
    return {
      id: device.id,
      entityId: device.entityId,
      name: device.name,
      type: device.type,
      roomName: device.roomName,
      isOnline: device.status.isOnline,
      isOn: device.status.isOn,
      stateDisplay: device.status.stateDisplay,
    };
  }

  /**
   * Map multiple entities to devices
   */
  static mapEntities(
    entities: EntityState[],
    devices: Map<string, HADeviceInfo>,
    areas: Map<string, HAAreaInfo>,
    entityRegistry: Map<string, { device_id?: string; area_id?: string }>
  ): Device[] {
    return entities.map((entity) => {
      const registryEntry = entityRegistry.get(entity.entity_id);
      const deviceInfo = registryEntry?.device_id
        ? devices.get(registryEntry.device_id)
        : undefined;
      const areaId = registryEntry?.area_id ?? deviceInfo?.area_id;
      const areaInfo = areaId ? areas.get(areaId) : undefined;

      return this.mapEntity(entity, deviceInfo, areaInfo);
    });
  }
}
