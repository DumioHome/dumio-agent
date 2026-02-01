import type { IHomeAssistantClient } from '../../domain/ports/IHomeAssistantClient.js';
import type { ICloudClient } from '../../domain/ports/ICloudClient.js';
import type { ILogger } from '../../domain/ports/ILogger.js';
import type { EntityState } from '../../domain/entities/Entity.js';
import type { Device, DeviceType } from '../../domain/entities/Device.js';
import type { 
  CloudCapabilityType, 
  CloudCapabilityValue,
  CloudDevice,
} from '../../domain/entities/CloudDevice.js';

/**
 * Entity to Device mapping stored in memory
 */
interface EntityDeviceMapping {
  deviceId: string;
  entityId: string;
  deviceType: DeviceType;
  capabilityType: CloudCapabilityType;
}

/**
 * Cached state for comparison
 */
interface CachedState {
  value: CloudCapabilityValue;
  timestamp: number;
}

/**
 * Service that watches for HA state changes and sends real-time updates to cloud
 * Must be initialized after a successful devices:sync
 * Only sends updates when values actually change (optimized for performance)
 */
export class DeviceStateWatcher {
  /** Map of entityId -> device mapping info */
  private entityMappings = new Map<string, EntityDeviceMapping>();
  
  /** Map of entityId -> last sent value (for change detection) */
  private lastSentValues = new Map<string, CachedState>();
  
  /** Whether the watcher is currently active */
  private isWatching = false;
  
  /** Current homeId for updates */
  private currentHomeId: string | null = null;

  /** State change handler reference for cleanup */
  private stateChangeHandler: ((entityId: string, oldState: EntityState | null, newState: EntityState) => void) | null = null;
  
  /** Stats for debugging */
  private stats = {
    eventsReceived: 0,
    updatesSkipped: 0,
    updatesSent: 0,
  };

  constructor(
    private readonly haClient: IHomeAssistantClient,
    private readonly cloudClient: ICloudClient,
    private readonly logger: ILogger
  ) {}

  /**
   * Initialize the watcher with device mappings from a sync result
   * Call this after a successful devices:sync
   */
  initializeFromSync(homeId: string, devices: CloudDevice[]): void {
    this.currentHomeId = homeId;
    this.entityMappings.clear();
    this.lastSentValues.clear();
    this.resetStats();

    // Build entity -> device mapping
    for (const device of devices) {
      for (const entityId of device.entityIds) {
        // Determine the primary capability type for this entity
        const capabilityType = this.determineCapabilityType(entityId, device);
        
        this.entityMappings.set(entityId, {
          deviceId: device.deviceId,
          entityId,
          deviceType: device.deviceType,
          capabilityType,
        });
      }
    }

    this.logger.info('DeviceStateWatcher initialized', {
      homeId,
      mappedEntities: this.entityMappings.size,
      physicalDevices: devices.length,
    });
  }
  
  /**
   * Reset statistics
   */
  private resetStats(): void {
    this.stats = {
      eventsReceived: 0,
      updatesSkipped: 0,
      updatesSent: 0,
    };
  }

  /**
   * Start watching for state changes
   */
  startWatching(): void {
    if (this.isWatching) {
      this.logger.debug('DeviceStateWatcher already watching');
      return;
    }

    if (this.entityMappings.size === 0) {
      this.logger.warn('Cannot start watching: no entity mappings. Call initializeFromSync first.');
      return;
    }

    // Create the state change handler
    this.stateChangeHandler = (entityId: string, oldState: EntityState | null, newState: EntityState) => {
      this.handleStateChange(entityId, oldState, newState);
    };

    // Subscribe to state changes
    this.haClient.onStateChange(this.stateChangeHandler);
    
    this.isWatching = true;
    this.logger.info('DeviceStateWatcher started', {
      watchingEntities: this.entityMappings.size,
    });
  }

  /**
   * Stop watching for state changes
   */
  stopWatching(): void {
    if (!this.isWatching) {
      return;
    }

    if (this.stateChangeHandler) {
      this.haClient.offStateChange(this.stateChangeHandler);
      this.stateChangeHandler = null;
    }

    this.isWatching = false;
    this.logger.info('DeviceStateWatcher stopped');
  }

  /**
   * Clear all mappings and stop watching
   */
  reset(): void {
    this.stopWatching();
    this.entityMappings.clear();
    this.lastSentValues.clear();
    this.currentHomeId = null;
    this.logger.info('DeviceStateWatcher reset', { stats: this.stats });
    this.resetStats();
  }
  
  /**
   * Get current stats
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  /**
   * Check if watcher is active
   */
  get active(): boolean {
    return this.isWatching;
  }

  /**
   * Get current mapping count
   */
  get mappingCount(): number {
    return this.entityMappings.size;
  }

  /**
   * Handle a state change event from HA
   * Only sends update if the value actually changed
   */
  private handleStateChange(
    entityId: string, 
    oldState: EntityState | null, 
    newState: EntityState
  ): void {
    this.stats.eventsReceived++;
    
    // Check if this entity is one we're tracking
    const mapping = this.entityMappings.get(entityId);
    
    if (!mapping) {
      // Not a tracked entity, ignore
      return;
    }

    // Check if cloud client is connected
    if (this.cloudClient.connectionState !== 'connected') {
      this.logger.debug('Skipping capability update: cloud not connected', { entityId });
      this.stats.updatesSkipped++;
      return;
    }

    // Extract the new value based on capability type
    const currentValue = this.extractCapabilityValue(mapping.capabilityType, newState);

    if (currentValue === null) {
      this.logger.debug('Could not extract capability value', { 
        entityId, 
        capabilityType: mapping.capabilityType 
      });
      this.stats.updatesSkipped++;
      return;
    }

    // Check if value has actually changed
    const lastSent = this.lastSentValues.get(entityId);
    if (lastSent && this.areValuesEqual(lastSent.value, currentValue)) {
      // Value hasn't changed, skip sending
      this.stats.updatesSkipped++;
      return;
    }

    // Value changed, send update to cloud
    this.cloudClient.emit('capability:update', {
      deviceId: mapping.deviceId,
      entityId: mapping.entityId,
      capabilityType: mapping.capabilityType,
      currentValue,
      timestamp: new Date().toISOString(),
    });

    // Cache the sent value
    this.lastSentValues.set(entityId, {
      value: currentValue,
      timestamp: Date.now(),
    });

    this.stats.updatesSent++;

    this.logger.debug('Capability update sent to cloud', {
      deviceId: mapping.deviceId,
      entityId,
      capabilityType: mapping.capabilityType,
      newValue: currentValue,
      stats: this.stats,
    });
  }
  
  /**
   * Compare two capability values for equality
   */
  private areValuesEqual(a: CloudCapabilityValue, b: CloudCapabilityValue): boolean {
    // Compare 'on' boolean
    if (a.on !== undefined && b.on !== undefined) {
      return a.on === b.on;
    }
    
    // Compare 'value' (number or string)
    if (a.value !== undefined && b.value !== undefined) {
      // For numbers, use a small tolerance for floating point comparison
      if (typeof a.value === 'number' && typeof b.value === 'number') {
        return Math.abs(a.value - b.value) < 0.01;
      }
      return a.value === b.value;
    }
    
    // Compare RGB color
    if (a.r !== undefined && b.r !== undefined) {
      return a.r === b.r && a.g === b.g && a.b === b.b;
    }
    
    // Fallback: JSON comparison
    return JSON.stringify(a) === JSON.stringify(b);
  }

  /**
   * Determine the capability type for an entity based on its domain and the device info
   */
  private determineCapabilityType(entityId: string, device: CloudDevice): CloudCapabilityType {
    const [domain] = entityId.split('.');
    
    // Map domain to capability type
    const domainMapping: Record<string, CloudCapabilityType> = {
      light: 'switch',
      switch: 'switch',
      fan: 'switch',
      climate: 'mode',
      cover: 'position',
      lock: 'lock',
      media_player: 'switch',
      vacuum: 'switch',
    };

    if (domainMapping[domain]) {
      return domainMapping[domain];
    }

    // For sensors, try to determine from the device capabilities
    if (domain === 'sensor' || domain === 'binary_sensor') {
      // Check if this entity has a specific capability in the device
      const specificCaps: CloudCapabilityType[] = ['temperature', 'humidity', 'power', 'battery', 'energy'];
      
      for (const cap of device.capabilities) {
        if (specificCaps.includes(cap.capabilityType)) {
          // Check if the entity name suggests this capability
          const entityLower = entityId.toLowerCase();
          if (entityLower.includes('temp') && cap.capabilityType === 'temperature') {
            return 'temperature';
          }
          if (entityLower.includes('humid') && cap.capabilityType === 'humidity') {
            return 'humidity';
          }
          if (entityLower.includes('power') && cap.capabilityType === 'power') {
            return 'power';
          }
          if (entityLower.includes('battery') && cap.capabilityType === 'battery') {
            return 'battery';
          }
          if (entityLower.includes('energy') && cap.capabilityType === 'energy') {
            return 'energy';
          }
        }
      }

      // For binary sensors
      if (domain === 'binary_sensor') {
        const entityLower = entityId.toLowerCase();
        if (entityLower.includes('motion')) return 'motion';
        if (entityLower.includes('door')) return 'door';
        if (entityLower.includes('window')) return 'window';
      }

      return 'sensor';
    }

    return 'switch';
  }

  /**
   * Extract the capability value from HA state based on capability type
   */
  private extractCapabilityValue(
    capabilityType: CloudCapabilityType, 
    state: EntityState
  ): CloudCapabilityValue | null {
    const stateValue = state.state;
    const attrs = state.attributes;

    switch (capabilityType) {
      case 'switch':
        return { on: stateValue === 'on' || stateValue === 'playing' || stateValue === 'cleaning' };

      case 'brightness':
        if (attrs.brightness !== undefined) {
          return { value: Math.round((attrs.brightness as number) / 255 * 100) };
        }
        return null;

      case 'color_temp':
        if (attrs.color_temp_kelvin !== undefined) {
          return { value: attrs.color_temp_kelvin as number };
        }
        if (attrs.color_temp !== undefined) {
          return { value: Math.round(1000000 / (attrs.color_temp as number)) };
        }
        return null;

      case 'color':
        if (attrs.rgb_color !== undefined) {
          const rgb = attrs.rgb_color as number[];
          return { r: rgb[0], g: rgb[1], b: rgb[2] };
        }
        return null;

      case 'temperature':
        const temp = attrs.temperature ?? attrs.current_temperature ?? parseFloat(stateValue);
        if (!isNaN(temp as number)) {
          return { value: temp as number };
        }
        return null;

      case 'humidity':
        const humidity = attrs.humidity ?? attrs.current_humidity ?? parseFloat(stateValue);
        if (!isNaN(humidity as number)) {
          return { value: humidity as number };
        }
        return null;

      case 'battery':
        const battery = attrs.battery_level ?? attrs.battery ?? parseFloat(stateValue);
        if (!isNaN(battery as number)) {
          return { value: battery as number };
        }
        return null;

      case 'power':
        const power = attrs.power ?? parseFloat(stateValue);
        if (!isNaN(power as number)) {
          return { value: power as number };
        }
        return null;

      case 'energy':
        const energy = attrs.energy ?? parseFloat(stateValue);
        if (!isNaN(energy as number)) {
          return { value: energy as number };
        }
        return null;

      case 'position':
        const position = attrs.current_position ?? parseFloat(stateValue);
        if (!isNaN(position as number)) {
          return { value: position as number };
        }
        return null;

      case 'volume':
        if (attrs.volume_level !== undefined) {
          return { value: Math.round((attrs.volume_level as number) * 100) };
        }
        return null;

      case 'mode':
        const mode = attrs.hvac_mode ?? stateValue;
        return { value: mode as string };

      case 'preset':
        if (attrs.preset_mode !== undefined) {
          return { value: attrs.preset_mode as string };
        }
        return null;

      case 'motion':
      case 'door':
      case 'window':
        return { on: stateValue === 'on' || stateValue === 'open' };

      case 'lock':
        return { on: stateValue === 'locked' };

      case 'sensor':
        // Generic sensor - try to parse as number
        const numValue = parseFloat(stateValue);
        if (!isNaN(numValue)) {
          return { value: numValue };
        }
        return { value: stateValue };

      default:
        return null;
    }
  }
}
