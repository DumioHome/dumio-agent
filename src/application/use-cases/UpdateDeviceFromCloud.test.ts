import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpdateDeviceFromCloud } from './UpdateDeviceFromCloud.js';
import type { IHomeAssistantClient } from '../../domain/ports/IHomeAssistantClient.js';
import type { ILogger } from '../../domain/ports/ILogger.js';
import type { DeviceUpdate } from '../../domain/ports/ICloudClient.js';

describe('UpdateDeviceFromCloud', () => {
  let mockHaClient: IHomeAssistantClient;
  let mockLogger: ILogger;
  let useCase: UpdateDeviceFromCloud;

  beforeEach(() => {
    mockHaClient = {
      connectionState: 'connected',
      haVersion: '2024.1.0',
      connect: vi.fn(),
      disconnect: vi.fn(),
      sendCommand: vi.fn().mockResolvedValue({ 
        success: true, 
        id: 1, 
        type: 'result',
        result: {}
      }),
      subscribeEvents: vi.fn(),
      unsubscribeEvents: vi.fn(),
      getStates: vi.fn(),
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

    useCase = new UpdateDeviceFromCloud(mockHaClient, mockLogger);
  });

  it('should update entity registry successfully when name is provided', async () => {
    const deviceUpdate: DeviceUpdate = {
      id: 'device-uuid-123',
      deviceId: 'ha-device-123',
      entityIds: ['light.living_room'],
      name: 'Nuevo Nombre',
    };

    const result = await useCase.execute({ deviceUpdate });

    expect(mockHaClient.sendCommand).toHaveBeenCalledWith({
      type: 'config/entity_registry/update',
      entity_id: 'light.living_room',
      name: 'Nuevo Nombre',
    });
    expect(result.success).toBe(true);
    expect(result.updatedEntities).toContain('light.living_room');
    expect(result.message).toContain('successfully');
  });

  it('should update multiple entities when multiple entityIds are provided', async () => {
    const deviceUpdate: DeviceUpdate = {
      id: 'device-uuid-123',
      deviceId: 'ha-device-123',
      entityIds: ['light.living_room', 'switch.living_room'],
      name: 'Sala de Estar',
    };

    const result = await useCase.execute({ deviceUpdate });

    expect(mockHaClient.sendCommand).toHaveBeenCalledTimes(3); // 2 entities + 1 device registry
    expect(result.success).toBe(true);
    expect(result.updatedEntities).toHaveLength(2);
    expect(result.updatedEntities).toContain('light.living_room');
    expect(result.updatedEntities).toContain('switch.living_room');
  });

  it('should update device registry when deviceId is provided', async () => {
    const deviceUpdate: DeviceUpdate = {
      id: 'device-uuid-123',
      deviceId: 'ha-device-123',
      name: 'Dispositivo Actualizado',
      model: 'Modelo XYZ',
      manufacturer: 'Fabricante ABC',
    };

    const result = await useCase.execute({ deviceUpdate });

    expect(mockHaClient.sendCommand).toHaveBeenCalledWith({
      type: 'config/device_registry/update',
      device_id: 'ha-device-123',
      name_by_user: 'Dispositivo Actualizado',
      model: 'Modelo XYZ',
      manufacturer: 'Fabricante ABC',
    });
    expect(result.success).toBe(true);
  });

  it('should update both entity registry and device registry', async () => {
    const deviceUpdate: DeviceUpdate = {
      id: 'device-uuid-123',
      deviceId: 'ha-device-123',
      entityIds: ['light.living_room'],
      name: 'Luz Principal',
      model: 'Modelo 2024',
    };

    const result = await useCase.execute({ deviceUpdate });

    // Should update entity registry
    expect(mockHaClient.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'config/entity_registry/update',
        entity_id: 'light.living_room',
        name: 'Luz Principal',
      })
    );

    // Should update device registry
    expect(mockHaClient.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'config/device_registry/update',
        device_id: 'ha-device-123',
        name_by_user: 'Luz Principal',
        model: 'Modelo 2024',
      })
    );

    expect(result.success).toBe(true);
  });

  it('should fail when device id is missing', async () => {
    const deviceUpdate: DeviceUpdate = {
      id: '',
      deviceId: 'ha-device-123',
      name: 'Test',
    };

    const result = await useCase.execute({ deviceUpdate });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Missing device id');
  });

  it('should fail when no deviceId or entityIds are provided', async () => {
    const deviceUpdate: DeviceUpdate = {
      id: 'device-uuid-123',
      name: 'Test',
    };

    const result = await useCase.execute({ deviceUpdate });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing deviceId or entityIds');
  });

  it('should handle entity registry update failure gracefully', async () => {
    mockHaClient.sendCommand = vi.fn()
      .mockResolvedValueOnce({
        success: false,
        error: { message: 'Entity not found' },
        id: 1,
        type: 'result',
      })
      .mockResolvedValueOnce({
        success: true,
        id: 2,
        type: 'result',
        result: {},
      });

    const deviceUpdate: DeviceUpdate = {
      id: 'device-uuid-123',
      entityIds: ['light.invalid', 'light.valid'],
      name: 'Test',
    };

    const result = await useCase.execute({ deviceUpdate });

    // Should continue with other entities even if one fails
    expect(result.success).toBe(true);
    expect(result.updatedEntities).toContain('light.valid');
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to update entity registry',
      expect.objectContaining({
        entityId: 'light.invalid',
      })
    );
  });

  it('should handle device registry update failure gracefully', async () => {
    mockHaClient.sendCommand = vi.fn()
      .mockResolvedValueOnce({
        success: true,
        id: 1,
        type: 'result',
        result: {},
      })
      .mockResolvedValueOnce({
        success: false,
        error: { message: 'Device not found' },
        id: 2,
        type: 'result',
      });

    const deviceUpdate: DeviceUpdate = {
      id: 'device-uuid-123',
      deviceId: 'ha-device-123',
      entityIds: ['light.living_room'],
      name: 'Test',
    };

    const result = await useCase.execute({ deviceUpdate });

    // Should still succeed if entity registry update worked
    expect(result.success).toBe(true);
    expect(result.updatedEntities).toContain('light.living_room');
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to update device registry',
      expect.objectContaining({
        deviceId: 'ha-device-123',
      })
    );
  });

  it('should include deviceCategoryId in logs', async () => {
    const deviceUpdate: DeviceUpdate = {
      id: 'device-uuid-123',
      deviceId: 'ha-device-123',
      entityIds: ['light.living_room'],
      name: 'Test',
      deviceCategoryId: 'category-123',
    };

    await useCase.execute({ deviceUpdate });

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Executing UpdateDeviceFromCloud use case',
      expect.objectContaining({
        deviceCategoryId: 'category-123',
      })
    );
  });

  it('should succeed but not update anything if no metadata is provided', async () => {
    const deviceUpdate: DeviceUpdate = {
      id: 'device-uuid-123',
      deviceId: 'ha-device-123',
      entityIds: ['light.living_room'],
      // No name, model, or manufacturer
    };

    const result = await useCase.execute({ deviceUpdate });

    // Should succeed but not update anything since there's no name to update
    expect(result.success).toBe(false);
    expect(result.error).toContain('No valid update targets');
    expect(mockHaClient.sendCommand).not.toHaveBeenCalled();
  });

  it('should update device registry with only name', async () => {
    const deviceUpdate: DeviceUpdate = {
      id: 'device-uuid-123',
      deviceId: 'ha-device-123',
      name: 'Solo Nombre',
    };

    const result = await useCase.execute({ deviceUpdate });

    expect(mockHaClient.sendCommand).toHaveBeenCalledWith({
      type: 'config/device_registry/update',
      device_id: 'ha-device-123',
      name_by_user: 'Solo Nombre',
    });
    expect(result.success).toBe(true);
  });
});
