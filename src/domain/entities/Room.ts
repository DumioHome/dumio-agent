/**
 * Room type/category
 */
export type RoomType =
  | 'living_room'
  | 'bedroom'
  | 'bathroom'
  | 'kitchen'
  | 'dining_room'
  | 'office'
  | 'garage'
  | 'garden'
  | 'balcony'
  | 'hallway'
  | 'basement'
  | 'attic'
  | 'laundry'
  | 'storage'
  | 'other';

/**
 * Mapped room model for database (from HA areas)
 */
export interface Room {
  id: string;
  areaId: string; // Original HA area_id
  name: string;
  type: RoomType;
  icon: string | null;
  floor: string | null;
  deviceCount: number;
  devicesOnline: number;
  devicesOn: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Room with devices
 */
export interface RoomWithDevices {
  room: Room;
  devices: import('./Device.js').DeviceSummary[];
}

/**
 * Room summary for lists
 */
export interface RoomSummary {
  id: string;
  name: string;
  type: RoomType;
  deviceCount: number;
  devicesOn: number;
}

/**
 * Floor grouping
 */
export interface Floor {
  id: string;
  name: string;
  rooms: RoomSummary[];
}

/**
 * Home overview with all rooms and devices
 */
export interface HomeOverview {
  totalDevices: number;
  devicesOnline: number;
  devicesOn: number;
  totalRooms: number;
  floors: Floor[];
  roomsWithoutFloor: RoomSummary[];
}
