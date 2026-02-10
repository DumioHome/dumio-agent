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

  it('should update device registry when deviceId and model are provided', async () => {
    const deviceUpdate: DeviceUpdate = {
      id: 'device-uuid-123',
      deviceId: 'ha-device-123',
      model: 'Modelo XYZ',
    };

    const result = await useCase.execute({ deviceUpdate });

    expect(mockHaClient.sendCommand).toHaveBeenCalledWith({
      type: 'config/device_registry/update',
      device_id: 'ha-device-123',
      model: 'Modelo XYZ',
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain('successfully');
  });

  it('should update device registry with model and manufacturer', async () => {
    const deviceUpdate: DeviceUpdate = {
      id: 'device-uuid-123',
      deviceId: 'ha-device-123',
      model: 'Modelo XYZ',
      manufacturer: 'Fabricante ABC',
    };

    const result = await useCase.execute({ deviceUpdate });

    expect(mockHaClient.sendCommand).toHaveBeenCalledWith({
      type: 'config/device_registry/update',
      device_id: 'ha-device-123',
      model: 'Modelo XYZ',
      manufacturer: 'Fabricante ABC',
    });
    expect(result.success).toBe(true);
  });

  it('should update device registry with only manufacturer', async () => {
    const deviceUpdate: DeviceUpdate = {
      id: 'device-uuid-123',
      deviceId: 'ha-device-123',
      manufacturer: 'Fabricante ABC',
    };

    const result = await useCase.execute({ deviceUpdate });

    expect(mockHaClient.sendCommand).toHaveBeenCalledWith({
      type: 'config/device_registry/update',
      device_id: 'ha-device-123',
      manufacturer: 'Fabricante ABC',
    });
    expect(result.success).toBe(true);
  });

  it('should fail when device id is missing', async () => {
    const deviceUpdate: DeviceUpdate = {
      id: '',
      deviceId: 'ha-device-123',
      model: 'Test Model',
    };

    const result = await useCase.execute({ deviceUpdate });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Missing device id');
  });

  it('should fail when no deviceId is provided and no metadata to update', async () => {
    const deviceUpdate: DeviceUpdate = {
      id: 'device-uuid-123',
      entityIds: ['light.living_room'],
      // No model or manufacturer
    };

    const result = await useCase.execute({ deviceUpdate });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No valid update targets');
  });

  it('should handle device registry update failure gracefully', async () => {
    mockHaClient.sendCommand = vi.fn().mockResolvedValue({
      success: false,
      error: { message: 'Device not found' },
      id: 1,
      type: 'result',
    });

    const deviceUpdate: DeviceUpdate = {
      id: 'device-uuid-123',
      deviceId: 'ha-device-123',
      model: 'Test Model',
    };

    const result = await useCase.execute({ deviceUpdate });

    expect(result.success).toBe(false);
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
      model: 'Test Model',
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

  it('should fail when no metadata is provided', async () => {
    const deviceUpdate: DeviceUpdate = {
      id: 'device-uuid-123',
      deviceId: 'ha-device-123',
      // No model or manufacturer
    };

    const result = await useCase.execute({ deviceUpdate });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No valid update targets');
    expect(mockHaClient.sendCommand).not.toHaveBeenCalled();
  });

  it('should log device registry update', async () => {
    const deviceUpdate: DeviceUpdate = {
      id: 'device-uuid-123',
      deviceId: 'ha-device-123',
      model: 'Test Model',
      manufacturer: 'Test Manufacturer',
    };

    await useCase.execute({ deviceUpdate });

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Updated device registry',
      expect.objectContaining({
        deviceId: 'ha-device-123',
        updates: {
          model: 'Test Model',
          manufacturer: 'Test Manufacturer',
        },
      })
    );
  });

  it('should handle device registry update exceptions gracefully', async () => {
    // Mock sendCommand to throw an error when called
    mockHaClient.sendCommand = vi.fn().mockRejectedValue(
      new Error('Network error')
    );

    const deviceUpdate: DeviceUpdate = {
      id: 'device-uuid-123',
      deviceId: 'ha-device-123',
      model: 'Test Model',
    };

    const result = await useCase.execute({ deviceUpdate });

    // When updateDeviceRegistry fails, it's caught and logged, but deviceRegistryUpdated stays false
    // So the result will be "No valid update targets found"
    expect(result.success).toBe(false);
    expect(result.error).toContain('No valid update targets');
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to update device registry',
      expect.objectContaining({
        deviceId: 'ha-device-123',
        error: 'Network error',
      })
    );
    // Should have attempted to call sendCommand
    expect(mockHaClient.sendCommand).toHaveBeenCalled();
  });
});
