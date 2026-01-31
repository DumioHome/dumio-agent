import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetDevices } from './GetDevices.js';
import type { IHomeAssistantClient } from '../../domain/ports/IHomeAssistantClient.js';
import type { ILogger } from '../../domain/ports/ILogger.js';
import type { EntityState } from '../../domain/entities/Entity.js';

describe('GetDevices', () => {
  let mockHaClient: IHomeAssistantClient;
  let mockLogger: ILogger;
  let useCase: GetDevices;
  let mockStates: EntityState[];

  beforeEach(() => {
    mockStates = [
      {
        entity_id: 'light.living_room',
        state: 'on',
        attributes: {
          friendly_name: 'Living Room Light',
          brightness: 255,
          supported_color_modes: ['brightness'],
        },
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
        entity_id: 'sensor.temperature',
        state: '22.5',
        attributes: {
          friendly_name: 'Temperature Sensor',
          unit_of_measurement: '°C',
          device_class: 'temperature',
        },
        last_changed: '2024-01-01T10:30:00Z',
        last_updated: '2024-01-01T10:30:00Z',
        context: { id: '3', parent_id: null, user_id: null },
      },
      {
        entity_id: 'switch.fan',
        state: 'unavailable',
        attributes: { friendly_name: 'Fan' },
        last_changed: '2024-01-01T08:00:00Z',
        last_updated: '2024-01-01T08:00:00Z',
        context: { id: '4', parent_id: null, user_id: null },
      },
    ];

    mockHaClient = {
      connectionState: 'connected',
      haVersion: '2024.1.0',
      connect: vi.fn(),
      disconnect: vi.fn(),
      sendCommand: vi.fn().mockImplementation(({ type }) => {
        if (type === 'config/device_registry/list') {
          return Promise.resolve({
            result: [
              { id: 'device1', name: 'Living Room Light', area_id: 'living_room' },
              { id: 'device2', name: 'Bedroom Light', area_id: 'bedroom' },
            ],
          });
        }
        if (type === 'config/area_registry/list') {
          return Promise.resolve({
            result: [
              { area_id: 'living_room', name: 'Sala de Estar' },
              { area_id: 'bedroom', name: 'Dormitorio' },
            ],
          });
        }
        if (type === 'config/entity_registry/list') {
          return Promise.resolve({
            result: [
              { entity_id: 'light.living_room', device_id: 'device1', area_id: 'living_room' },
              { entity_id: 'light.bedroom', device_id: 'device2', area_id: 'bedroom' },
              { entity_id: 'sensor.temperature', area_id: 'living_room' },
              { entity_id: 'switch.fan', area_id: 'bedroom' },
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

    useCase = new GetDevices(mockHaClient, mockLogger);
  });

  it('should return all devices mapped', async () => {
    const result = await useCase.execute();

    expect(result.count).toBe(4);
    expect(result.devices).toHaveLength(4);
  });

  it('should return correct online count', async () => {
    const result = await useCase.execute();

    // 3 online (living_room, bedroom, temperature), 1 unavailable (fan)
    expect(result.onlineCount).toBe(3);
  });

  it('should return correct on count', async () => {
    const result = await useCase.execute();

    // Only living_room light is on
    expect(result.onCount).toBe(1);
  });

  it('should map device type correctly', async () => {
    const result = await useCase.execute({ includeFullDetails: true });
    const devices = result.devices as any[];

    const light = devices.find((d) => d.entityId === 'light.living_room');
    const sensor = devices.find((d) => d.entityId === 'sensor.temperature');

    expect(light.type).toBe('light');
    expect(sensor.type).toBe('temperature'); // from device_class
  });

  it('should map state display correctly', async () => {
    const result = await useCase.execute({ includeFullDetails: true });
    const devices = result.devices as any[];

    const lightOn = devices.find((d) => d.entityId === 'light.living_room');
    const lightOff = devices.find((d) => d.entityId === 'light.bedroom');
    const sensor = devices.find((d) => d.entityId === 'sensor.temperature');

    expect(lightOn.status.stateDisplay).toBe('Encendido');
    expect(lightOff.status.stateDisplay).toBe('Apagado');
    expect(sensor.status.stateDisplay).toBe('22.5 °C');
  });

  it('should filter by type', async () => {
    const result = await useCase.execute({ filter: { type: 'light' } });

    expect(result.count).toBe(2);
  });

  it('should filter by online status', async () => {
    const result = await useCase.execute({ filter: { isOnline: true } });

    expect(result.count).toBe(3);
  });

  it('should filter by on status', async () => {
    const result = await useCase.execute({ filter: { isOn: true } });

    expect(result.count).toBe(1);
  });

  it('should filter by room', async () => {
    const result = await useCase.execute({ filter: { roomId: 'living_room' } });

    expect(result.count).toBe(2); // light and temperature sensor
  });

  it('should filter by search term', async () => {
    const result = await useCase.execute({ filter: { search: 'living' } });

    expect(result.count).toBe(1);
  });

  it('should map room name correctly', async () => {
    const result = await useCase.execute({ includeFullDetails: true });
    const devices = result.devices as any[];

    const livingRoomLight = devices.find((d) => d.entityId === 'light.living_room');
    expect(livingRoomLight.roomName).toBe('Sala de Estar');
  });

  it('should map brightness to percentage', async () => {
    const result = await useCase.execute({ includeFullDetails: true });
    const devices = result.devices as any[];

    const light = devices.find((d) => d.entityId === 'light.living_room');
    expect(light.status.attributes.brightness).toBe(100); // 255 -> 100%
  });

  it('should return summaries by default', async () => {
    const result = await useCase.execute();
    const device = result.devices[0] as any;

    // Summary should have limited fields
    expect(device).toHaveProperty('id');
    expect(device).toHaveProperty('name');
    expect(device).toHaveProperty('type');
    expect(device).toHaveProperty('isOnline');
    expect(device).not.toHaveProperty('capabilities');
  });

  it('should return full details when requested', async () => {
    const result = await useCase.execute({ includeFullDetails: true });
    const device = result.devices[0] as any;

    // Full device should have capabilities
    expect(device).toHaveProperty('capabilities');
    expect(device).toHaveProperty('manufacturer');
  });
});
