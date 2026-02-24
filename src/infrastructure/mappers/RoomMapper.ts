import type { Room, RoomType, RoomSummary, Floor, HomeOverview } from '../../domain/entities/Room.js';
import type { Device } from '../../domain/entities/Device.js';
import type { HAAreaInfo } from './DeviceMapper.js';

/**
 * Raw floor info from Home Assistant
 */
export interface HAFloorInfo {
  floor_id: string;
  name: string;
  level?: number;
  icon?: string;
}

/**
 * Maps Home Assistant areas to Room model
 */
export class RoomMapper {
  /**
   * Infer room type from name
   */
  static inferRoomType(name: string): RoomType {
    const nameLower = name.toLowerCase();

    const patterns: [RegExp, RoomType][] = [
      [/living|sala|salón|lounge/i, 'living_room'],
      [/bedroom|dormitorio|habitación|cuarto/i, 'bedroom'],
      [/bathroom|baño|aseo|wc/i, 'bathroom'],
      [/kitchen|cocina/i, 'kitchen'],
      [/dining|comedor/i, 'dining_room'],
      [/office|oficina|despacho|estudio/i, 'office'],
      [/garage|garaje|cochera/i, 'garage'],
      [/garden|jardín|patio|terraza/i, 'garden'],
      [/balcony|balcón/i, 'balcony'],
      [/hallway|pasillo|entrada|hall|vestíbulo/i, 'hallway'],
      [/basement|sótano/i, 'basement'],
      [/attic|ático|buhardilla/i, 'attic'],
      [/laundry|lavadero|lavandería/i, 'laundry'],
      [/storage|almacén|trastero/i, 'storage'],
    ];

    for (const [pattern, type] of patterns) {
      if (pattern.test(nameLower)) {
        return type;
      }
    }

    return 'other';
  }

  /**
   * Get default icon for room type
   */
  static getDefaultIcon(type: RoomType): string {
    const icons: Record<RoomType, string> = {
      living_room: 'mdi:sofa',
      bedroom: 'mdi:bed',
      bathroom: 'mdi:shower',
      kitchen: 'mdi:stove',
      dining_room: 'mdi:silverware-fork-knife',
      office: 'mdi:desk',
      garage: 'mdi:garage',
      garden: 'mdi:flower',
      balcony: 'mdi:balcony',
      hallway: 'mdi:door',
      basement: 'mdi:stairs-down',
      attic: 'mdi:stairs-up',
      laundry: 'mdi:washing-machine',
      storage: 'mdi:archive',
      other: 'mdi:home',
    };

    return icons[type];
  }

  /**
   * Map Home Assistant area to Room model
   */
  static mapArea(area: HAAreaInfo, devices: Device[], floor?: HAFloorInfo): Room {
    const now = new Date();
    const roomDevices = devices.filter((d) => d.roomId === area.area_id);
    const type = this.inferRoomType(area.name);

    return {
      id: area.area_id,
      areaId: area.area_id,
      name: area.name,
      type,
      icon: area.icon ?? this.getDefaultIcon(type),
      floor: floor?.name ?? null,
      deviceCount: roomDevices.length,
      devicesOnline: roomDevices.filter((d) => d.status.isOnline).length,
      devicesOn: roomDevices.filter((d) => d.status.isOn === true).length,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Map Room to summary
   */
  static mapToSummary(room: Room): RoomSummary {
    return {
      id: room.id,
      name: room.name,
      type: room.type,
      deviceCount: room.deviceCount,
      devicesOn: room.devicesOn,
    };
  }

  /**
   * Map multiple areas to rooms
   */
  static mapAreas(
    areas: HAAreaInfo[],
    devices: Device[],
    floors: Map<string, HAFloorInfo>
  ): Room[] {
    return areas.map((area) => {
      const floor = area.floor_id ? floors.get(area.floor_id) : undefined;
      return this.mapArea(area, devices, floor);
    });
  }

  /**
   * Build home overview
   */
  static buildHomeOverview(
    rooms: Room[],
    devices: Device[],
    floors: HAFloorInfo[]
  ): HomeOverview {
    const floorMap = new Map<string, RoomSummary[]>();
    const roomsWithoutFloor: RoomSummary[] = [];

    // Group rooms by floor
    for (const room of rooms) {
      const summary = this.mapToSummary(room);
      if (room.floor) {
        const floorRooms = floorMap.get(room.floor) ?? [];
        floorRooms.push(summary);
        floorMap.set(room.floor, floorRooms);
      } else {
        roomsWithoutFloor.push(summary);
      }
    }

    // Build floor objects
    const floorObjects: Floor[] = floors.map((f) => ({
      id: f.floor_id,
      name: f.name,
      rooms: floorMap.get(f.name) ?? [],
    }));

    // Sort floors by level if available
    floorObjects.sort((a, b) => {
      const floorA = floors.find((f) => f.floor_id === a.id);
      const floorB = floors.find((f) => f.floor_id === b.id);
      return (floorA?.level ?? 0) - (floorB?.level ?? 0);
    });

    return {
      totalDevices: devices.length,
      devicesOnline: devices.filter((d) => d.status.isOnline).length,
      devicesOn: devices.filter((d) => d.status.isOn === true).length,
      totalRooms: rooms.length,
      floors: floorObjects,
      roomsWithoutFloor,
    };
  }
}
