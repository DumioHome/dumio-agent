import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetRooms } from './GetRooms.js';
import type { IHomeAssistantClient } from '../../domain/ports/IHomeAssistantClient.js';
import type { ILogger } from '../../domain/ports/ILogger.js';
import type { EntityState } from '../../domain/entities/Entity.js';
import type { Room, RoomWithDevices } from '../../domain/entities/Room.js';

describe('GetRooms', () => {
  let mockHaClient: IHomeAssistantClient;
  let mockLogger: ILogger;
  let useCase: GetRooms;
  let mockStates: EntityState[];

  beforeEach(() => {
    mockStates = [
      {
        entity_id: 'light.living_room',
        state: 'on',
        attributes: { friendly_name: 'Living Room Light' },
        last_changed: '2024-01-01T10:00:00Z',
        last_updated: '2024-01-01T10:00:00Z',
        context: { id: '1', parent_id: null, user_id: null },
      },
      {
        entity_id: 'light.bedroom',
        state: 'off',
        attributes: { friendly_name: 'Bedroom Light' },
        last_changed: '2024-01-01T09:00:00Z',
        last_updated: '2024-01-01T09:00:00Z',
        context: { id: '2', parent_id: null, user_id: null },
      },
      {
        entity_id: 'sensor.living_temp',
        state: '22',
        attributes: { friendly_name: 'Living Temperature' },
        last_changed: '2024-01-01T10:30:00Z',
        last_updated: '2024-01-01T10:30:00Z',
        context: { id: '3', parent_id: null, user_id: null },
      },
    ];

    mockHaClient = {
      connectionState: 'connected',
      haVersion: '2024.1.0',
      connect: vi.fn(),
      disconnect: vi.fn(),
      sendCommand: vi.fn().mockImplementation(({ type }) => {
        if (type === 'config/device_registry/list') {
          return Promise.resolve({ result: [] });
        }
        if (type === 'config/area_registry/list') {
          return Promise.resolve({
            result: [
              { area_id: 'living_room', name: 'Sala de Estar', floor_id: 'floor1' },
              { area_id: 'bedroom', name: 'Dormitorio', floor_id: 'floor1' },
              { area_id: 'kitchen', name: 'Cocina', floor_id: 'floor1' },
            ],
          });
        }
        if (type === 'config/entity_registry/list') {
          return Promise.resolve({
            result: [
              { entity_id: 'light.living_room', area_id: 'living_room' },
              { entity_id: 'light.bedroom', area_id: 'bedroom' },
              { entity_id: 'sensor.living_temp', area_id: 'living_room' },
            ],
          });
        }
        if (type === 'config/floor_registry/list') {
          return Promise.resolve({
            result: [
              { floor_id: 'floor1', name: 'Planta Baja', level: 0 },
              { floor_id: 'floor2', name: 'Planta Alta', level: 1 },
            ],
          });
        }
        return Promise.resolve({ result: [] });
      }),
      subscribeEvents: vi.fn(),
      unsubscribeEvents: vi.fn(),
      getStates: vi.fn().mockResolvedValue(mockStates),
      getConfig: vi.fn(),
      getServices: vi.fn(),
      callService: vi.fn(),
      ping: vi.fn(),
      onMessage: vi.fn(),
      onEvent: vi.fn(),
      onStateChange: vi.fn(),
      onConnectionStateChange: vi.fn(),
      offMessage: vi.fn(),
      offEvent: vi.fn(),
      offStateChange: vi.fn(),
      offConnectionStateChange: vi.fn(),
    };

    mockLogger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };

    useCase = new GetRooms(mockHaClient, mockLogger);
  });

  it('should return all rooms', async () => {
    const result = await useCase.execute();

    expect(result.count).toBe(3);
    expect(result.rooms).toHaveLength(3);
  });

  it('should map room names correctly', async () => {
    const result = await useCase.execute();
    const rooms = result.rooms as Room[];

    const livingRoom = rooms.find((r) => r.id === 'living_room');
    expect(livingRoom.name).toBe('Sala de Estar');
  });

  it('should infer room type from name', async () => {
    const result = await useCase.execute();
    const rooms = result.rooms as Room[];

    const bedroom = rooms.find((r) => r.id === 'bedroom');
    const kitchen = rooms.find((r) => r.id === 'kitchen');

    expect(bedroom.type).toBe('bedroom');
    expect(kitchen.type).toBe('kitchen');
  });

  it('should count devices per room', async () => {
    const result = await useCase.execute();
    const rooms = result.rooms as Room[];

    const livingRoom = rooms.find((r) => r.id === 'living_room');
    const bedroom = rooms.find((r) => r.id === 'bedroom');

    expect(livingRoom.deviceCount).toBe(2); // light + sensor
    expect(bedroom.deviceCount).toBe(1); // light only
  });

  it('should count devices on per room', async () => {
    const result = await useCase.execute();
    const rooms = result.rooms as Room[];

    const livingRoom = rooms.find((r) => r.id === 'living_room');
    const bedroom = rooms.find((r) => r.id === 'bedroom');

    expect(livingRoom.devicesOn).toBe(1); // light is on
    expect(bedroom.devicesOn).toBe(0); // light is off
  });

  it('should include floor name', async () => {
    const result = await useCase.execute();
    const rooms = result.rooms as Room[];

    const livingRoom = rooms.find((r) => r.id === 'living_room');
    expect(livingRoom.floor).toBe('Planta Baja');
  });

  it('should include devices when requested', async () => {
    const result = await useCase.execute({ includeDevices: true });
    const roomsWithDevices = result.rooms as RoomWithDevices[];

    const livingRoom = roomsWithDevices.find((r) => r.room.id === 'living_room');
    expect(livingRoom.devices).toHaveLength(2);
    expect(livingRoom.devices[0]).toHaveProperty('name');
    expect(livingRoom.devices[0]).toHaveProperty('type');
  });

  it('should get home overview', async () => {
    const result = await useCase.getHomeOverview();
    const overview = result.overview;

    expect(overview.totalDevices).toBe(3);
    expect(overview.totalRooms).toBe(3);
    expect(overview.devicesOn).toBe(1);
  });

  it('should organize rooms by floor in overview', async () => {
    const result = await useCase.getHomeOverview();
    const overview = result.overview;

    expect(overview.floors).toHaveLength(2);
    const floor1 = overview.floors.find((f) => f.id === 'floor1');
    expect(floor1?.rooms).toHaveLength(3);
  });

  it('should get specific room with devices', async () => {
    const result = await useCase.getRoomWithDevices('living_room');

    expect(result).not.toBeNull();
    expect(result?.room.name).toBe('Sala de Estar');
    expect(result?.devices).toHaveLength(2);
  });

  it('should return null for non-existent room', async () => {
    const result = await useCase.getRoomWithDevices('non_existent');

    expect(result).toBeNull();
  });

  it('should provide default icon based on room type', async () => {
    const result = await useCase.execute();
    const rooms = result.rooms as Room[];

    const bedroom = rooms.find((r) => r.id === 'bedroom');
    const kitchen = rooms.find((r) => r.id === 'kitchen');

    expect(bedroom?.icon).toBe('mdi:bed');
    expect(kitchen?.icon).toBe('mdi:stove');
  });
});
