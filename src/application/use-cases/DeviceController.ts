import type { IHomeAssistantClient } from '../../domain/ports/IHomeAssistantClient.js';
import type { ILogger } from '../../domain/ports/ILogger.js';
import type { 
  DeviceControlCommand, 
  DeviceControlResponse,
  CloudCapabilityType,
  CloudCapabilityValue,
  CloudDevice,
} from '../../domain/entities/CloudDevice.js';

/**
 * Mapping of deviceId -> CloudDevice info (set after sync)
 */
interface DeviceMapping {
  deviceId: string;
  entityIds: string[];
  primaryEntityId: string;
  deviceType: string;
}

/**
 * Use case for controlling devices via commands from cloud
 * Maps capability commands to Home Assistant service calls
 */
export class DeviceController {
  /** Map of deviceId -> device info */
  private deviceMappings = new Map<string, DeviceMapping>();

  constructor(
    private readonly haClient: IHomeAssistantClient,
    private readonly logger: ILogger
  ) {}

  /**
   * Initialize device mappings from sync result
   * Call this after a successful devices:sync
   */
  initializeFromSync(devices: CloudDevice[]): void {
    this.deviceMappings.clear();

    for (const device of devices) {
      this.deviceMappings.set(device.deviceId, {
        deviceId: device.deviceId,
        entityIds: device.entityIds,
        primaryEntityId: this.selectPrimaryEntity(device.entityIds),
        deviceType: device.deviceType,
      });
    }

    this.logger.info('DeviceController initialized', {
      mappedDevices: this.deviceMappings.size,
    });
  }

  /**
   * Execute a device control command
   */
  async execute(command: DeviceControlCommand): Promise<DeviceControlResponse> {
    this.logger.info('Executing device control command', {
      deviceId: command.deviceId,
      entityId: command.entityId,
      capabilityType: command.capabilityType,
      value: command.value,
    });

    try {
      // Get the entity ID to control
      const entityId = this.resolveEntityId(command);

      if (!entityId) {
        return {
          success: false,
          deviceId: command.deviceId,
          message: 'Device not found',
          error: `No mapping found for device ${command.deviceId}`,
        };
      }

      // Map capability to HA service call
      const serviceCall = this.mapCapabilityToService(
        entityId,
        command.capabilityType,
        command.value
      );

      if (!serviceCall) {
        return {
          success: false,
          deviceId: command.deviceId,
          entityId,
          message: 'Unsupported capability',
          error: `Cannot map capability ${command.capabilityType} to HA service`,
        };
      }

      // Execute the service call
      await this.haClient.callService(
        serviceCall.domain,
        serviceCall.service,
        {
          entity_id: entityId,
          ...serviceCall.data,
        }
      );

      this.logger.info('Device control command executed', {
        deviceId: command.deviceId,
        entityId,
        service: `${serviceCall.domain}.${serviceCall.service}`,
      });

      return {
        success: true,
        deviceId: command.deviceId,
        entityId,
        message: `Successfully executed ${command.capabilityType} command`,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Device control command failed', { 
        error: errorMessage,
        command,
      });

      return {
        success: false,
        deviceId: command.deviceId,
        entityId: command.entityId,
        message: 'Command execution failed',
        error: errorMessage,
      };
    }
  }

  /**
   * Resolve the entity ID to control
   */
  private resolveEntityId(command: DeviceControlCommand): string | null {
    // If entityId is provided, use it directly
    if (command.entityId) {
      return command.entityId;
    }

    // Look up by deviceId
    const mapping = this.deviceMappings.get(command.deviceId);
    
    if (!mapping) {
      // Try using deviceId as entityId directly (fallback)
      if (command.deviceId.includes('.')) {
        return command.deviceId;
      }
      return null;
    }

    // Find the best entity for this capability type
    return this.findEntityForCapability(mapping, command.capabilityType);
  }

  /**
   * Find the best entity ID for a given capability
   */
  private findEntityForCapability(
    mapping: DeviceMapping, 
    capabilityType: CloudCapabilityType
  ): string {
    // Map capability types to domain preferences
    const domainPreferences: Record<string, string[]> = {
      switch: ['switch', 'light', 'fan', 'media_player'],
      brightness: ['light'],
      color_temp: ['light'],
      color: ['light'],
      temperature: ['climate', 'sensor'],
      humidity: ['sensor', 'humidifier'],
      position: ['cover'],
      volume: ['media_player'],
      mode: ['climate', 'fan'],
      preset: ['climate'],
      lock: ['lock'],
    };

    const preferences = domainPreferences[capabilityType] ?? [];

    // Find entity matching preferred domain
    for (const preferredDomain of preferences) {
      const matchingEntity = mapping.entityIds.find(id => 
        id.startsWith(`${preferredDomain}.`)
      );
      if (matchingEntity) {
        return matchingEntity;
      }
    }

    // Fallback to primary entity
    return mapping.primaryEntityId;
  }

  /**
   * Select the primary entity from a list (prefer controllable entities)
   */
  private selectPrimaryEntity(entityIds: string[]): string {
    const priority = ['light', 'switch', 'climate', 'cover', 'fan', 'media_player', 'lock'];

    for (const domain of priority) {
      const match = entityIds.find(id => id.startsWith(`${domain}.`));
      if (match) return match;
    }

    return entityIds[0];
  }

  /**
   * Map a capability command to a Home Assistant service call
   */
  private mapCapabilityToService(
    entityId: string,
    capabilityType: CloudCapabilityType,
    value: CloudCapabilityValue
  ): { domain: string; service: string; data?: Record<string, unknown> } | null {
    const [domain] = entityId.split('.');

    switch (capabilityType) {
      case 'switch':
        return {
          domain: domain === 'light' ? 'light' : domain === 'fan' ? 'fan' : domain,
          service: value.on ? 'turn_on' : 'turn_off',
        };

      case 'brightness':
        if (value.value === undefined) return null;
        return {
          domain: 'light',
          service: 'turn_on',
          data: {
            brightness_pct: value.value,
          },
        };

      case 'color_temp':
        if (value.value === undefined) return null;
        return {
          domain: 'light',
          service: 'turn_on',
          data: {
            color_temp_kelvin: value.value,
          },
        };

      case 'color':
        if (value.r === undefined) return null;
        return {
          domain: 'light',
          service: 'turn_on',
          data: {
            rgb_color: [value.r, value.g, value.b],
          },
        };

      case 'temperature':
        if (value.value === undefined) return null;
        return {
          domain: 'climate',
          service: 'set_temperature',
          data: {
            temperature: value.value,
          },
        };

      case 'position':
        if (value.value === undefined) return null;
        return {
          domain: 'cover',
          service: 'set_cover_position',
          data: {
            position: value.value,
          },
        };

      case 'volume':
        if (value.value === undefined || typeof value.value !== 'number') return null;
        return {
          domain: 'media_player',
          service: 'volume_set',
          data: {
            volume_level: value.value / 100,
          },
        };

      case 'mode':
        if (value.value === undefined) return null;
        return {
          domain: 'climate',
          service: 'set_hvac_mode',
          data: {
            hvac_mode: value.value,
          },
        };

      case 'preset':
        if (value.value === undefined) return null;
        return {
          domain: 'climate',
          service: 'set_preset_mode',
          data: {
            preset_mode: value.value,
          },
        };

      case 'lock':
        return {
          domain: 'lock',
          service: value.on ? 'lock' : 'unlock',
        };

      case 'motion':
      case 'door':
      case 'window':
      case 'humidity':
      case 'battery':
      case 'power':
      case 'energy':
      case 'sensor':
        // These are read-only sensors, cannot control
        return null;

      default:
        return null;
    }
  }

  /**
   * Check if a device is mapped
   */
  hasDevice(deviceId: string): boolean {
    return this.deviceMappings.has(deviceId);
  }

  /**
   * Get mapping count
   */
  get mappingCount(): number {
    return this.deviceMappings.size;
  }
}
