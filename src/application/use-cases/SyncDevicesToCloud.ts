import type { IHomeAssistantClient } from '../../domain/ports/IHomeAssistantClient.js';
import type { ICloudClient } from '../../domain/ports/ICloudClient.js';
import type { ILogger } from '../../domain/ports/ILogger.js';
import type { Device, DeviceType, DeviceAttributes } from '../../domain/entities/Device.js';
import type {
  CloudDevice,
  CloudCapability,
  CloudCapabilityType,
  CloudValueType,
  CloudCapabilityMeta,
  CloudCapabilityValue,
  DevicesSyncCallbackResponse,
} from '../../domain/entities/CloudDevice.js';
import { GetDevices } from './GetDevices.js';

export interface SyncDevicesToCloudInput {
  homeId: string;
}

export interface SyncDevicesToCloudOutput {
  success: boolean;
  syncedDevices: number;
  /** The cloud devices that were synced (for initializing state watcher) */
  devices?: CloudDevice[];
  response?: DevicesSyncCallbackResponse;
  error?: string;
}

/**
 * Use case for syncing devices from Home Assistant to the cloud
 * Transforms HA devices to the cloud format and emits the sync event
 */
export class SyncDevicesToCloud {
  private readonly getDevicesUseCase: GetDevices;

  constructor(
    private readonly haClient: IHomeAssistantClient,
    private readonly cloudClient: ICloudClient,
    private readonly logger: ILogger
  ) {
    this.getDevicesUseCase = new GetDevices(haClient, logger);
  }

  async execute(input: SyncDevicesToCloudInput): Promise<SyncDevicesToCloudOutput> {
    this.logger.info('Executing SyncDevicesToCloud use case', { homeId: input.homeId });

    try {
      // Get all devices with full details from HA
      const devicesResult = await this.getDevicesUseCase.execute({
        includeFullDetails: true,
      });

      const haDevices = devicesResult.devices as Device[];
      
      this.logger.debug('Fetched entities from Home Assistant', {
        entityCount: haDevices.length,
      });

      // Group entities by physical device ID and transform to cloud format
      const cloudDevices = this.groupAndTransformDevices(haDevices);

      this.logger.debug('Transformed to physical devices', {
        physicalDeviceCount: cloudDevices.length,
        totalEntities: haDevices.length,
      });

      // Emit sync event to cloud with callback
      this.logger.debug('Sending devices:sync to cloud', {
        homeId: input.homeId,
        deviceCount: cloudDevices.length,
        devices: cloudDevices.map(d => ({ 
          deviceId: d.deviceId, 
          name: d.name, 
          type: d.deviceType,
          entityCount: d.entityIds.length,
          capabilities: d.capabilities.length,
        })),
      });

      const response = await this.cloudClient.emitWithCallback(
        'devices:sync',
        {
          homeId: input.homeId,
          devices: cloudDevices,
        },
        30000 // 30 second timeout
      );

      this.logger.info('Devices synced to cloud', {
        homeId: input.homeId,
        syncedDevices: cloudDevices.length,
        success: response.success,
        cloudResponse: response,
      });

      return {
        success: response.success,
        syncedDevices: cloudDevices.length,
        devices: cloudDevices,
        response,
        error: response.error,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Error syncing devices to cloud', { error: errorMessage });

      return {
        success: false,
        syncedDevices: 0,
        error: errorMessage,
      };
    }
  }

  /**
   * Transform HA devices to CloudDevice format
   * Each entity becomes a separate CloudDevice, but entities from the same physical device
   * share the same deviceId (from HA device registry) to identify they belong together
   */
  private groupAndTransformDevices(haDevices: Device[]): CloudDevice[] {
    const cloudDevices: CloudDevice[] = [];

    for (const device of haDevices) {
      const cloudDevice = this.createCloudDeviceFromEntity(device);
      cloudDevices.push(cloudDevice);
    }

    return cloudDevices;
  }

  /**
   * Create a CloudDevice from a single entity
   * Uses the device registry ID as deviceId to group entities from the same physical device
   */
  private createCloudDeviceFromEntity(device: Device): CloudDevice {
    // Extract capabilities for this entity
    const capabilities = this.extractCapabilities(device);

    return {
      // Use the HA device registry ID to identify the physical device
      // Multiple entities from the same physical device will share this ID
      deviceId: device.id,
      // This entity's ID
      entityIds: [device.entityId],
      deviceType: device.type,
      name: device.name,
      model: device.model,
      manufacturer: device.manufacturer,
      roomName: device.roomName,
      integration: device.integration,
      capabilities,
    };
  }

  /**
   * Extract capabilities from device based on its type and attributes
   */
  private extractCapabilities(device: Device): CloudCapability[] {
    const capabilities: CloudCapability[] = [];
    const { status, type, capabilities: deviceCaps } = device;
    const { attributes } = status;

    // Add switch capability for controllable devices
    if (deviceCaps.canTurnOn || deviceCaps.canTurnOff) {
      capabilities.push({
        capabilityType: 'switch',
        valueType: 'boolean',
        currentValue: { on: status.isOn ?? false },
        meta: { description: 'Encender/Apagar' },
      });
    }

    // Add brightness capability
    if (deviceCaps.canDim && attributes.brightness !== undefined) {
      capabilities.push({
        capabilityType: 'brightness',
        valueType: 'number',
        currentValue: { value: attributes.brightness },
        meta: { min: 0, max: 100, unit: '%' },
      });
    }

    // Add color temperature capability
    if (attributes.colorTemp !== undefined) {
      capabilities.push({
        capabilityType: 'color_temp',
        valueType: 'number',
        currentValue: { value: attributes.colorTemp },
        meta: { min: 2700, max: 6500, unit: 'K' },
      });
    }

    // Add color capability
    if (deviceCaps.canChangeColor && attributes.color) {
      capabilities.push({
        capabilityType: 'color',
        valueType: 'object',
        currentValue: {
          r: attributes.color.r,
          g: attributes.color.g,
          b: attributes.color.b,
        },
        meta: null,
      });
    }

    // Add temperature capability for sensors/climate
    if (attributes.temperature !== undefined || attributes.currentTemperature !== undefined) {
      const tempValue = attributes.currentTemperature ?? attributes.temperature;
      capabilities.push({
        capabilityType: 'temperature',
        valueType: 'number',
        currentValue: { value: tempValue },
        meta: { unit: attributes.unit ?? '°C' },
      });
    }

    // Add humidity capability
    if (attributes.humidity !== undefined) {
      capabilities.push({
        capabilityType: 'humidity',
        valueType: 'number',
        currentValue: { value: attributes.humidity },
        meta: { unit: '%' },
      });
    }

    // Add battery capability
    if (attributes.battery !== undefined) {
      capabilities.push({
        capabilityType: 'battery',
        valueType: 'number',
        currentValue: { value: attributes.battery },
        meta: { min: 0, max: 100, unit: '%' },
      });
    }

    // Add power capability
    if (attributes.power !== undefined) {
      capabilities.push({
        capabilityType: 'power',
        valueType: 'number',
        currentValue: { value: attributes.power },
        meta: { unit: 'W' },
      });
    }

    // Add energy capability
    if (attributes.energy !== undefined) {
      capabilities.push({
        capabilityType: 'energy',
        valueType: 'number',
        currentValue: { value: attributes.energy },
        meta: { unit: 'kWh' },
      });
    }

    // Add position capability for covers
    if (deviceCaps.canSetPosition && attributes.position !== undefined) {
      capabilities.push({
        capabilityType: 'position',
        valueType: 'number',
        currentValue: { value: attributes.position },
        meta: { min: 0, max: 100, unit: '%' },
      });
    }

    // Add volume capability for media players
    if (deviceCaps.canSetVolume && attributes.volume !== undefined) {
      capabilities.push({
        capabilityType: 'volume',
        valueType: 'number',
        currentValue: { value: attributes.volume },
        meta: { min: 0, max: 100, unit: '%' },
      });
    }

    // Add mode capability for climate devices
    if (attributes.mode !== undefined) {
      capabilities.push({
        capabilityType: 'mode',
        valueType: 'string',
        currentValue: { value: attributes.mode },
        meta: null,
      });
    }

    // Add preset capability
    if (attributes.preset !== undefined) {
      capabilities.push({
        capabilityType: 'preset',
        valueType: 'string',
        currentValue: { value: attributes.preset },
        meta: null,
      });
    }

    // Add binary sensor specific capabilities
    if (type === 'binary_sensor') {
      const capabilityType = this.mapBinarySensorCapability(device);
      if (capabilityType) {
        capabilities.push({
          capabilityType,
          valueType: 'boolean',
          currentValue: { on: status.isOn ?? false },
          meta: null,
        });
      }
    }

    // Add lock capability
    if (type === 'lock') {
      capabilities.push({
        capabilityType: 'lock',
        valueType: 'boolean',
        currentValue: { on: status.state === 'locked' },
        meta: { description: 'Bloqueado/Desbloqueado' },
      });
    }

    // If no capabilities were added, add a basic state capability based on type
    if (capabilities.length === 0) {
      capabilities.push(this.getDefaultCapability(device));
    }

    return capabilities;
  }

  /**
   * Map binary sensor device class to capability type
   */
  private mapBinarySensorCapability(device: Device): CloudCapabilityType | null {
    switch (device.type) {
      case 'motion':
        return 'motion';
      case 'door':
        return 'door';
      case 'window':
        return 'window';
      default:
        return null;
    }
  }

  /**
   * Get default capability for devices without specific capabilities
   */
  private getDefaultCapability(device: Device): CloudCapability {
    const { status, type } = device;

    // For sensors, return the state value
    if (['sensor', 'temperature', 'humidity', 'power', 'battery'].includes(type)) {
      return {
        capabilityType: this.mapSensorType(type),
        valueType: 'number',
        currentValue: { value: parseFloat(status.state) || 0 },
        meta: { unit: status.attributes.unit ?? '' },
      };
    }

    // Default switch capability
    return {
      capabilityType: 'switch',
      valueType: 'boolean',
      currentValue: { on: status.isOn ?? false },
      meta: null,
    };
  }

  /**
   * Map device type to sensor capability type
   */
  private mapSensorType(type: DeviceType): CloudCapabilityType {
    const mapping: Partial<Record<DeviceType, CloudCapabilityType>> = {
      temperature: 'temperature',
      humidity: 'humidity',
      power: 'power',
      battery: 'battery',
      sensor: 'sensor',
    };
    return mapping[type] ?? 'sensor';
  }
}
