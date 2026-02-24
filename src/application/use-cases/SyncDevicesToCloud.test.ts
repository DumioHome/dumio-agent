import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncDevicesToCloud } from './SyncDevicesToCloud.js';
import type { IHomeAssistantClient } from '../../domain/ports/IHomeAssistantClient.js';
import type { ICloudClient } from '../../domain/ports/ICloudClient.js';
import type { ILogger } from '../../domain/ports/ILogger.js';
import type { EntityState } from '../../domain/entities/Entity.js';
import type { DevicesSyncCallbackResponse, CloudDevice, CloudCapability } from '../../domain/entities/CloudDevice.js';

describe('SyncDevicesToCloud', () => {
  let mockHaClient: IHomeAssistantClient;
  let mockCloudClient: ICloudClient;
  let mockLogger: ILogger;
  let useCase: SyncDevicesToCloud;
  let mockStates: EntityState[];

  const mockSyncResponse: DevicesSyncCallbackResponse = {
    success: true,
    data: {
      devices: [
        { id: 'device1', deviceType: 'light', name: 'Living Room Light' },
        { id: 'device2', deviceType: 'switch', name: 'Kitchen Switch' },
        { id: 'device3', deviceType: 'temperature', name: 'Temperature' },
        { id: 'device3', deviceType: 'humidity', name: 'Humidity' },
      ],
    },
  };

  beforeEach(() => {
    // 4 entities but only 3 physical devices (temp + humidity share device3)
    mockStates = [
      {
        entity_id: 'light.living_room',
        state: 'on',
        attributes: {
          friendly_name: 'Living Room Light',
          brightness: 191, // ~75%
          color_temp_kelvin: 4000,
          supported_color_modes: ['brightness', 'color_temp'],
        },
        last_changed: '2024-01-01T10:00:00Z',
        last_updated: '2024-01-01T10:00:00Z',
        context: { id: '1', parent_id: null, user_id: null },
      },
      {
        entity_id: 'switch.kitchen',
        state: 'off',
        attributes: { friendly_name: 'Kitchen Switch' },
        last_changed: '2024-01-01T09:00:00Z',
        last_updated: '2024-01-01T09:00:00Z',
        context: { id: '2', parent_id: null, user_id: null },
      },
      {
        entity_id: 'sensor.temperature',
        state: '22.5',
        attributes: {
          friendly_name: 'Temperature',
          unit_of_measurement: '°C',
          device_class: 'temperature',
        },
        last_changed: '2024-01-01T10:30:00Z',
        last_updated: '2024-01-01T10:30:00Z',
        context: { id: '3', parent_id: null, user_id: null },
      },
      {
        entity_id: 'sensor.humidity',
        state: '65',
        attributes: {
          friendly_name: 'Humidity',
          unit_of_measurement: '%',
          device_class: 'humidity',
        },
        last_changed: '2024-01-01T10:30:00Z',
        last_updated: '2024-01-01T10:30:00Z',
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
              { 
                id: 'device1', 
                name: 'Living Room Light', 
                manufacturer: 'Philips',
                model: 'Smart Bulb E27',
                area_id: 'living_room',
                identifiers: [['tuya', 'abc123']],
              },
              { 
                id: 'device2', 
                name: 'Kitchen Switch', 
                manufacturer: 'TP-Link',
                model: 'Smart Plug',
                area_id: 'kitchen',
                identifiers: [['tplink', 'def456']],
              },
              { 
                // Single physical device with temp + humidity sensors
                id: 'device3', 
                name: 'Multi Sensor', 
                manufacturer: 'Xiaomi',
                model: 'TH01',
                area_id: 'living_room',
                identifiers: [['xiaomi_miio', 'ghi789']],
              },
            ],
          });
        }
        if (type === 'config/area_registry/list') {
          return Promise.resolve({
            result: [
              { area_id: 'living_room', name: 'Sala de Estar' },
              { area_id: 'kitchen', name: 'Cocina' },
            ],
          });
        }
        if (type === 'config/entity_registry/list') {
          return Promise.resolve({
            result: [
              { entity_id: 'light.living_room', device_id: 'device1', area_id: 'living_room' },
              { entity_id: 'switch.kitchen', device_id: 'device2', area_id: 'kitchen' },
              // Both sensors belong to the same physical device (device3)
              { entity_id: 'sensor.temperature', device_id: 'device3', area_id: 'living_room' },
              { entity_id: 'sensor.humidity', device_id: 'device3', area_id: 'living_room' },
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

    mockCloudClient = {
      connectionState: 'connected',
      connect: vi.fn(),
      disconnect: vi.fn(),
      sendHealth: vi.fn(),
      emit: vi.fn(),
      emitWithCallback: vi.fn().mockResolvedValue(mockSyncResponse),
      on: vi.fn(),
      off: vi.fn(),
      onConnectionStateChange: vi.fn(),
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

    useCase = new SyncDevicesToCloud(mockHaClient, mockCloudClient, mockLogger);
  });

  it('should sync each entity as a separate CloudDevice', async () => {
    const result = await useCase.execute({ homeId: 'test-home-id' });

    expect(result.success).toBe(true);
    // Each entity is a separate CloudDevice (4 entities = 4 devices)
    expect(result.syncedDevices).toBe(4);
    expect(result.response).toEqual(mockSyncResponse);
  });

  it('should emit devices:sync event with correct payload structure', async () => {
    await useCase.execute({ homeId: 'test-home-id' });

    expect(mockCloudClient.emitWithCallback).toHaveBeenCalledWith(
      'devices:sync',
      expect.objectContaining({
        homeId: 'test-home-id',
        devices: expect.any(Array),
      }),
      30000
    );

    const emitCall = vi.mocked(mockCloudClient.emitWithCallback).mock.calls[0];
    const payload = emitCall[1];
    
    // Each entity is a separate CloudDevice
    expect(payload.devices).toHaveLength(4);
  });

  it('should use HA device registry ID as deviceId to identify physical device', async () => {
    await useCase.execute({ homeId: 'test-home-id' });

    const emitCall = vi.mocked(mockCloudClient.emitWithCallback).mock.calls[0];
    const payload = emitCall[1];
    
    // Find both sensors - they should have the same deviceId (device3) 
    // because they belong to the same physical device
    const tempSensor = payload.devices.find((d: CloudDevice) => d.entityIds.includes('sensor.temperature'));
    const humiditySensor = payload.devices.find((d: CloudDevice) => d.entityIds.includes('sensor.humidity'));

    expect(tempSensor).toBeDefined();
    expect(humiditySensor).toBeDefined();
    
    // Both should have the same deviceId (physical device ID from HA registry)
    expect(tempSensor.deviceId).toBe('device3');
    expect(humiditySensor.deviceId).toBe('device3');
    
    // But different entityIds
    expect(tempSensor.entityIds).toEqual(['sensor.temperature']);
    expect(humiditySensor.entityIds).toEqual(['sensor.humidity']);
  });

  it('should create separate CloudDevices for entities from same physical device', async () => {
    await useCase.execute({ homeId: 'test-home-id' });

    const emitCall = vi.mocked(mockCloudClient.emitWithCallback).mock.calls[0];
    const payload = emitCall[1];
    
    // Both sensors are separate CloudDevices
    const tempSensor = payload.devices.find((d: CloudDevice) => d.entityIds.includes('sensor.temperature'));
    const humiditySensor = payload.devices.find((d: CloudDevice) => d.entityIds.includes('sensor.humidity'));

    // Temperature sensor
    expect(tempSensor.deviceType).toBe('temperature');
    expect(tempSensor.capabilities).toHaveLength(1);
    expect(tempSensor.capabilities[0].capabilityType).toBe('temperature');

    // Humidity sensor
    expect(humiditySensor.deviceType).toBe('humidity');
    expect(humiditySensor.capabilities).toHaveLength(1);
    expect(humiditySensor.capabilities[0].capabilityType).toBe('humidity');
  });

  it('should transform light device with correct capabilities', async () => {
    await useCase.execute({ homeId: 'test-home-id' });

    const emitCall = vi.mocked(mockCloudClient.emitWithCallback).mock.calls[0];
    const payload = emitCall[1];
    const lightDevice = payload.devices.find((d: CloudDevice) => d.entityIds.includes('light.living_room'));

    expect(lightDevice).toBeDefined();
    expect(lightDevice.deviceId).toBe('device1');
    expect(lightDevice.deviceType).toBe('light');
    // name field is no longer sent - device names are managed via GraphQL mutations
    expect(lightDevice.name).toBeUndefined();
    expect(lightDevice.manufacturer).toBe('Philips');
    expect(lightDevice.model).toBe('Smart Bulb E27');
    expect(lightDevice.roomName).toBe('Sala de Estar');
    expect(lightDevice.integration).toBe('tuya');

    // Check capabilities
    const switchCap = lightDevice.capabilities.find((c: CloudCapability) => c.capabilityType === 'switch');
    expect(switchCap).toBeDefined();
    expect(switchCap.currentValue.on).toBe(true);

    const brightnessCap = lightDevice.capabilities.find((c: CloudCapability) => c.capabilityType === 'brightness');
    expect(brightnessCap).toBeDefined();
    expect(brightnessCap.currentValue.value).toBe(75);
  });

  it('should transform switch device with correct capabilities', async () => {
    await useCase.execute({ homeId: 'test-home-id' });

    const emitCall = vi.mocked(mockCloudClient.emitWithCallback).mock.calls[0];
    const payload = emitCall[1];
    const switchDevice = payload.devices.find((d: CloudDevice) => d.entityIds.includes('switch.kitchen'));

    expect(switchDevice).toBeDefined();
    expect(switchDevice.deviceId).toBe('device2');
    expect(switchDevice.deviceType).toBe('switch');
    // name field is no longer sent - device names are managed via GraphQL mutations
    expect(switchDevice.name).toBeUndefined();
    expect(switchDevice.manufacturer).toBe('TP-Link');
    expect(switchDevice.model).toBe('Smart Plug');
    expect(switchDevice.entityIds).toEqual(['switch.kitchen']);

    const switchCap = switchDevice.capabilities.find((c: CloudCapability) => c.capabilityType === 'switch');
    expect(switchCap).toBeDefined();
    expect(switchCap.currentValue.on).toBe(false);
  });

  it('should handle cloud error response', async () => {
    const errorResponse: DevicesSyncCallbackResponse = {
      success: false,
      error: 'Sync failed',
    };
    vi.mocked(mockCloudClient.emitWithCallback).mockResolvedValueOnce(errorResponse);

    const result = await useCase.execute({ homeId: 'test-home-id' });

    expect(result.success).toBe(false);
    expect(result.response?.error).toBe('Sync failed');
  });

  it('should handle timeout error', async () => {
    vi.mocked(mockCloudClient.emitWithCallback).mockRejectedValueOnce(new Error('Timeout'));

    const result = await useCase.execute({ homeId: 'test-home-id' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Timeout');
    expect(result.syncedDevices).toBe(0);
  });

  it('should log sync execution with device count', async () => {
    await useCase.execute({ homeId: 'test-home-id' });

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Executing SyncDevicesToCloud use case',
      expect.objectContaining({ homeId: 'test-home-id' })
    );

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Devices synced to cloud',
      expect.objectContaining({
        homeId: 'test-home-id',
        syncedDevices: 4, // Each entity is a separate CloudDevice
        success: true,
      })
    );
  });
});
