import type { IHomeAssistantClient } from '../../domain/ports/IHomeAssistantClient.js';
import type { ILogger } from '../../domain/ports/ILogger.js';
import type { Device, DeviceFilter, DeviceSummary } from '../../domain/entities/Device.js';
import { EXCLUDED_DOMAINS, PHYSICAL_DEVICE_DOMAINS, VIRTUAL_DEVICE_INTEGRATIONS } from '../../domain/entities/Device.js';
import { DeviceMapper, type HADeviceInfo, type HAAreaInfo } from '../../infrastructure/mappers/DeviceMapper.js';
import type { EntityState } from '../../domain/entities/Entity.js';
import { DUMIO_OFFICIAL_ENTITY_PREFIX } from '../../domain/entities/DumioEntity.js';

export interface GetDevicesInput {
  filter?: DeviceFilter;
  includeFullDetails?: boolean;
}

export interface GetDevicesOutput {
  devices: Device[] | DeviceSummary[];
  count: number;
  onlineCount: number;
  onCount: number;
}

interface EntityRegistryEntry {
  entity_id: string;
  device_id?: string;
  area_id?: string;
  disabled_by?: string;
  hidden_by?: string;
  entity_category?: string;
}

/**
 * Use case for getting mapped devices from Home Assistant (WebSocket device registry).
 * By default, only returns real physical devices: must have identifiers, manufacturer or model,
 * and must not be virtual (helpers, scripts, zones, updates).
 */
export class GetDevices {
  constructor(
    private readonly haClient: IHomeAssistantClient,
    private readonly logger: ILogger
  ) {}

  async execute(input: GetDevicesInput = {}): Promise<GetDevicesOutput> {
    this.logger.info('Executing GetDevices use case', { filter: input.filter });

    try {
      // Fetch all required data in parallel
      const [states, deviceRegistry, areaRegistry, entityRegistry] = await Promise.all([
        this.haClient.getStates(),
        this.fetchDeviceRegistry(),
        this.fetchAreaRegistry(),
        this.fetchEntityRegistry(),
      ]);

      // Build lookup maps - only include real physical devices (identifiers + manufacturer|model, not virtual)
      const devicesMap = new Map<string, HADeviceInfo>();
      const deviceIntegrations = new Map<string, string>(); // device_id -> integration
      
      for (const device of deviceRegistry) {
        if (device.disabled_by) continue;

        const integration = this.extractDeviceIntegration(device);
        if (integration) {
          deviceIntegrations.set(device.id, integration);
        }

        // Unless includeAll, only include real devices: identifiers, manufacturer or model, not virtual
        if (input.filter?.includeAll || this.isRealDevice(device, integration)) {
          devicesMap.set(device.id, device);
        }
      }

      const areasMap = new Map<string, HAAreaInfo>();
      for (const area of areaRegistry) {
        areasMap.set(area.area_id, area);
      }

      const entityRegMap = new Map<string, EntityRegistryEntry>();
      for (const entry of entityRegistry) {
        entityRegMap.set(entry.entity_id, entry);
      }

      // Default filter: only physical devices (real-device filter already applied to devicesMap)
      const filter: DeviceFilter = {
        onlyPhysical: true,
        ...input.filter,
      };

      // Pre-filter states to only include relevant entities
      let filteredStates = states;

      if (!filter.includeAll) {
        filteredStates = this.filterPhysicalEntities(states, entityRegMap, devicesMap, filter.onlyPhysical ?? true);
      }

      // Map filtered entities to devices
      let devices = DeviceMapper.mapEntities(filteredStates, devicesMap, areasMap, entityRegMap);

      // Apply additional filters
      devices = this.applyFilter(devices, filter);

      // Calculate stats
      const onlineCount = devices.filter((d) => d.status.isOnline).length;
      const onCount = devices.filter((d) => d.status.isOn === true).length;

      this.logger.info('Devices retrieved', {
        total: devices.length,
        online: onlineCount,
        on: onCount,
        filtered: states.length - filteredStates.length,
      });

      // Return full details or summaries
      if (input.includeFullDetails) {
        return {
          devices,
          count: devices.length,
          onlineCount,
          onCount,
        };
      }

      return {
        devices: devices.map(DeviceMapper.mapToSummary),
        count: devices.length,
        onlineCount,
        onCount,
      };
    } catch (error) {
      this.logger.error('Error getting devices', error);
      throw error;
    }
  }

  /**
   * Filter to only include physical/real device entities
   */
  private filterPhysicalEntities(
    states: EntityState[],
    entityRegistry: Map<string, EntityRegistryEntry>,
    deviceRegistry: Map<string, HADeviceInfo>,
    onlyPhysical: boolean
  ): EntityState[] {
    return states.filter((state) => {
      const [domain] = state.entity_id.split('.');
      const registryEntry = entityRegistry.get(state.entity_id);

      // Official Dumio entities (e.g. climate.dumio_plug_ac_living, sensor.dumio_plug_sensor_battery)
      // are always considered relevant, even if HA marks them as diagnostic or they lack device_id.
      const [, namePart] = state.entity_id.split('.');
      const isDumioOfficial =
        typeof namePart === 'string' && namePart.startsWith(DUMIO_OFFICIAL_ENTITY_PREFIX);

      // Exclude system/virtual domains
      if (EXCLUDED_DOMAINS.includes(domain as (typeof EXCLUDED_DOMAINS)[number])) {
        return false;
      }

      // Exclude disabled entities
      if (registryEntry?.disabled_by) {
        return false;
      }

      // Exclude hidden entities
      if (registryEntry?.hidden_by) {
        return false;
      }

      // Exclude diagnostic/config entities (usually not user-facing)
      // but keep official Dumio entities regardless of category so all dumio_plug_* are available.
      if (
        !isDumioOfficial &&
        (registryEntry?.entity_category === 'diagnostic' || registryEntry?.entity_category === 'config')
      ) {
        return false;
      }

      // If onlyPhysical, require a device_id (real physical device) — unless it's a Dumio official entity
      if (onlyPhysical && !isDumioOfficial) {
        if (!registryEntry?.device_id) {
          return false;
        }
        // Verify the device exists and is not disabled
        const device = deviceRegistry.get(registryEntry.device_id);
        if (!device) {
          return false;
        }
      }

      // Only include known physical device domains
      if (!PHYSICAL_DEVICE_DOMAINS.includes(domain as (typeof PHYSICAL_DEVICE_DOMAINS)[number])) {
        return false;
      }

      return true;
    });
  }

  private applyFilter(devices: Device[], filter: DeviceFilter): Device[] {
    let result = devices;

    // Filter by integration (tuya, zha, mqtt, etc.)
    if (filter.integration) {
      const intLower = filter.integration.toLowerCase();
      result = result.filter((d) => 
        d.integration?.toLowerCase() === intLower ||
        d.integration?.toLowerCase().includes(intLower)
      );
    }

    // Filter by multiple integrations
    if (filter.integrations && filter.integrations.length > 0) {
      const integrationsLower = filter.integrations.map((i) => i.toLowerCase());
      result = result.filter((d) => 
        d.integration && integrationsLower.some((int) => 
          d.integration!.toLowerCase() === int ||
          d.integration!.toLowerCase().includes(int)
        )
      );
    }

    // Filter by manufacturer
    if (filter.manufacturer) {
      const mfrLower = filter.manufacturer.toLowerCase();
      result = result.filter((d) =>
        d.manufacturer?.toLowerCase().includes(mfrLower)
      );
    }

    // Filter by room
    if (filter.roomId) {
      result = result.filter((d) => d.roomId === filter.roomId);
    }

    // Filter by type
    if (filter.type) {
      result = result.filter((d) => d.type === filter.type);
    }

    // Filter by types (multiple)
    if (filter.types && filter.types.length > 0) {
      result = result.filter((d) => filter.types!.includes(d.type));
    }

    // Filter by online status
    if (filter.isOnline !== undefined) {
      result = result.filter((d) => d.status.isOnline === filter.isOnline);
    }

    // Filter by on status
    if (filter.isOn !== undefined) {
      result = result.filter((d) => d.status.isOn === filter.isOn);
    }

    // Search by name
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      result = result.filter(
        (d) =>
          d.name.toLowerCase().includes(searchLower) ||
          d.entityId.toLowerCase().includes(searchLower) ||
          d.roomName?.toLowerCase().includes(searchLower)
      );
    }

    return result;
  }

  private async fetchDeviceRegistry(): Promise<HADeviceInfo[]> {
    try {
      const result = await this.haClient.sendCommand<HADeviceInfo[]>({
        type: 'config/device_registry/list',
      });
      return result.result ?? [];
    } catch (error) {
      this.logger.warn('Could not fetch device registry', { error });
      return [];
    }
  }

  private async fetchAreaRegistry(): Promise<HAAreaInfo[]> {
    try {
      const result = await this.haClient.sendCommand<HAAreaInfo[]>({
        type: 'config/area_registry/list',
      });
      return result.result ?? [];
    } catch (error) {
      this.logger.warn('Could not fetch area registry', { error });
      return [];
    }
  }

  private async fetchEntityRegistry(): Promise<Array<{ entity_id: string; device_id?: string; area_id?: string }>> {
    try {
      const result = await this.haClient.sendCommand<Array<{ entity_id: string; device_id?: string; area_id?: string }>>({
        type: 'config/entity_registry/list',
      });
      return result.result ?? [];
    } catch (error) {
      this.logger.warn('Could not fetch entity registry', { error });
      return [];
    }
  }

  /**
   * Returns true if the device is a real physical device to sync (not virtual).
   * Rules: must have identifiers; must have manufacturer or model; must not be helper/script/zone/update.
   */
  private isRealDevice(device: HADeviceInfo, integration: string | null): boolean {
    // Must have at least one identifier
    if (!device.identifiers?.length) {
      return false;
    }
    const hasManufacturer = typeof device.manufacturer === 'string' && device.manufacturer.trim().length > 0;
    const hasModel = typeof device.model === 'string' && device.model.trim().length > 0;
    if (!hasManufacturer && !hasModel) {
      return false;
    }
    // Exclude virtual devices (helpers, scripts, zones, updates)
    if (device.entry_type === 'service') {
      return false;
    }
    if (integration && VIRTUAL_DEVICE_INTEGRATIONS.includes(integration as (typeof VIRTUAL_DEVICE_INTEGRATIONS)[number])) {
      return false;
    }
    return true;
  }

  /**
   * Extract integration name from device info
   */
  private extractDeviceIntegration(device: HADeviceInfo): string | null {
    // Primary: get from identifiers
    if (device.identifiers && device.identifiers.length > 0) {
      const [integration] = device.identifiers[0];
      return integration?.toLowerCase() ?? null;
    }

    // Fallback: infer from manufacturer
    if (device.manufacturer) {
      const mfr = device.manufacturer.toLowerCase();
      if (mfr.includes('tuya') || mfr.includes('smart life')) return 'tuya';
      if (mfr.includes('xiaomi') || mfr.includes('aqara') || mfr.includes('mija')) return 'xiaomi_miio';
      if (mfr.includes('philips hue') || mfr === 'signify') return 'hue';
      if (mfr.includes('ikea')) return 'ikea';
      if (mfr.includes('shelly')) return 'shelly';
      if (mfr.includes('sonoff')) return 'sonoff';
      if (mfr.includes('tp-link') || mfr.includes('tplink') || mfr.includes('kasa')) return 'tplink';
      if (mfr.includes('yeelight')) return 'yeelight';
      if (mfr.includes('espressif') || mfr.includes('esphome')) return 'esphome';
      if (mfr.includes('tasmota')) return 'tasmota';
      if (mfr.includes('zigbee')) return 'zha';
    }

    return null;
  }

}
