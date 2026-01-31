import type { IHomeAssistantClient } from '../../domain/ports/IHomeAssistantClient.js';
import type { ILogger } from '../../domain/ports/ILogger.js';
import type { Room, RoomSummary, RoomWithDevices, HomeOverview } from '../../domain/entities/Room.js';
import type { DeviceSummary } from '../../domain/entities/Device.js';
import { DeviceMapper, type HADeviceInfo, type HAAreaInfo } from '../../infrastructure/mappers/DeviceMapper.js';
import { RoomMapper, type HAFloorInfo } from '../../infrastructure/mappers/RoomMapper.js';

export interface GetRoomsInput {
  includeDevices?: boolean;
}

export interface GetRoomsOutput {
  rooms: Room[] | RoomWithDevices[];
  count: number;
}

export interface GetHomeOverviewOutput {
  overview: HomeOverview;
}

/**
 * Use case for getting mapped rooms from Home Assistant
 */
export class GetRooms {
  constructor(
    private readonly haClient: IHomeAssistantClient,
    private readonly logger: ILogger
  ) {}

  async execute(input: GetRoomsInput = {}): Promise<GetRoomsOutput> {
    this.logger.info('Executing GetRooms use case');

    try {
      // Fetch all required data in parallel
      const [states, deviceRegistry, areaRegistry, entityRegistry, floorRegistry] = await Promise.all([
        this.haClient.getStates(),
        this.fetchDeviceRegistry(),
        this.fetchAreaRegistry(),
        this.fetchEntityRegistry(),
        this.fetchFloorRegistry(),
      ]);

      // Build lookup maps
      const devicesMap = new Map<string, HADeviceInfo>();
      for (const device of deviceRegistry) {
        devicesMap.set(device.id, device);
      }

      const areasMap = new Map<string, HAAreaInfo>();
      for (const area of areaRegistry) {
        areasMap.set(area.area_id, area);
      }

      const floorsMap = new Map<string, HAFloorInfo>();
      for (const floor of floorRegistry) {
        floorsMap.set(floor.floor_id, floor);
      }

      const entityRegMap = new Map<string, { device_id?: string; area_id?: string }>();
      for (const entry of entityRegistry) {
        entityRegMap.set(entry.entity_id, entry);
      }

      // Map entities to devices
      const devices = DeviceMapper.mapEntities(states, devicesMap, areasMap, entityRegMap);

      // Map areas to rooms
      const rooms = RoomMapper.mapAreas(areaRegistry, devices, floorsMap);

      this.logger.info('Rooms retrieved', { count: rooms.length });

      // Include devices if requested
      if (input.includeDevices) {
        const roomsWithDevices: RoomWithDevices[] = rooms.map((room) => ({
          room,
          devices: devices
            .filter((d) => d.roomId === room.id)
            .map(DeviceMapper.mapToSummary),
        }));

        return {
          rooms: roomsWithDevices,
          count: rooms.length,
        };
      }

      return {
        rooms,
        count: rooms.length,
      };
    } catch (error) {
      this.logger.error('Error getting rooms', error);
      throw error;
    }
  }

  /**
   * Get a complete home overview with floors, rooms, and device stats
   */
  async getHomeOverview(): Promise<GetHomeOverviewOutput> {
    this.logger.info('Executing GetHomeOverview');

    try {
      const [states, deviceRegistry, areaRegistry, entityRegistry, floorRegistry] = await Promise.all([
        this.haClient.getStates(),
        this.fetchDeviceRegistry(),
        this.fetchAreaRegistry(),
        this.fetchEntityRegistry(),
        this.fetchFloorRegistry(),
      ]);

      // Build lookup maps
      const devicesMap = new Map<string, HADeviceInfo>();
      for (const device of deviceRegistry) {
        devicesMap.set(device.id, device);
      }

      const areasMap = new Map<string, HAAreaInfo>();
      for (const area of areaRegistry) {
        areasMap.set(area.area_id, area);
      }

      const floorsMap = new Map<string, HAFloorInfo>();
      for (const floor of floorRegistry) {
        floorsMap.set(floor.floor_id, floor);
      }

      const entityRegMap = new Map<string, { device_id?: string; area_id?: string }>();
      for (const entry of entityRegistry) {
        entityRegMap.set(entry.entity_id, entry);
      }

      // Map entities to devices
      const devices = DeviceMapper.mapEntities(states, devicesMap, areasMap, entityRegMap);

      // Map areas to rooms
      const rooms = RoomMapper.mapAreas(areaRegistry, devices, floorsMap);

      // Build overview
      const overview = RoomMapper.buildHomeOverview(rooms, devices, floorRegistry);

      this.logger.info('Home overview built', {
        totalDevices: overview.totalDevices,
        totalRooms: overview.totalRooms,
        floors: overview.floors.length,
      });

      return { overview };
    } catch (error) {
      this.logger.error('Error getting home overview', error);
      throw error;
    }
  }

  /**
   * Get a specific room with its devices
   */
  async getRoomWithDevices(roomId: string): Promise<RoomWithDevices | null> {
    this.logger.info('Getting room with devices', { roomId });

    try {
      const result = await this.execute({ includeDevices: true });
      const roomsWithDevices = result.rooms as RoomWithDevices[];
      return roomsWithDevices.find((r) => r.room.id === roomId) ?? null;
    } catch (error) {
      this.logger.error('Error getting room with devices', error);
      throw error;
    }
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

  private async fetchFloorRegistry(): Promise<HAFloorInfo[]> {
    try {
      const result = await this.haClient.sendCommand<HAFloorInfo[]>({
        type: 'config/floor_registry/list',
      });
      return result.result ?? [];
    } catch (error) {
      this.logger.warn('Could not fetch floor registry (may not be supported)', { error });
      return [];
    }
  }
}
