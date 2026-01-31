import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallService } from './CallService.js';
import type { IHomeAssistantClient } from '../../domain/ports/IHomeAssistantClient.js';
import type { ILogger } from '../../domain/ports/ILogger.js';

describe('CallService', () => {
  let mockHaClient: IHomeAssistantClient;
  let mockLogger: ILogger;
  let useCase: CallService;

  beforeEach(() => {
    mockHaClient = {
      connectionState: 'connected',
      haVersion: '2024.1.0',
      connect: vi.fn(),
      disconnect: vi.fn(),
      sendCommand: vi.fn(),
      subscribeEvents: vi.fn(),
      unsubscribeEvents: vi.fn(),
      getStates: vi.fn(),
      getConfig: vi.fn(),
      getServices: vi.fn(),
      callService: vi.fn().mockResolvedValue({ success: true, id: 1, type: 'result' }),
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

    useCase = new CallService(mockHaClient, mockLogger);
  });

  it('should call service successfully', async () => {
    const result = await useCase.execute({
      domain: 'light',
      service: 'turn_on',
      entityId: 'light.living_room',
    });

    expect(mockHaClient.callService).toHaveBeenCalledWith(
      'light',
      'turn_on',
      undefined,
      { entity_id: 'light.living_room' }
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain('light.turn_on');
  });

  it('should call service with data', async () => {
    await useCase.execute({
      domain: 'light',
      service: 'turn_on',
      entityId: 'light.living_room',
      data: { brightness: 255 },
    });

    expect(mockHaClient.callService).toHaveBeenCalledWith(
      'light',
      'turn_on',
      { brightness: 255 },
      { entity_id: 'light.living_room' }
    );
  });

  it('should throw error when domain is missing', async () => {
    await expect(useCase.execute({
      domain: '',
      service: 'turn_on',
    })).rejects.toThrow('Domain and service are required');
  });

  it('should throw error when service is missing', async () => {
    await expect(useCase.execute({
      domain: 'light',
      service: '',
    })).rejects.toThrow('Domain and service are required');
  });

  it('should handle service failure', async () => {
    mockHaClient.callService = vi.fn().mockResolvedValue({
      success: false,
      error: { code: 'not_found', message: 'Entity not found' },
      id: 1,
      type: 'result',
    });

    const result = await useCase.execute({
      domain: 'light',
      service: 'turn_on',
      entityId: 'light.non_existent',
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe('Entity not found');
  });

  it('should call service with multiple entity IDs', async () => {
    await useCase.execute({
      domain: 'light',
      service: 'turn_off',
      entityId: ['light.living_room', 'light.bedroom'],
    });

    expect(mockHaClient.callService).toHaveBeenCalledWith(
      'light',
      'turn_off',
      undefined,
      { entity_id: ['light.living_room', 'light.bedroom'] }
    );
  });

  it('should log service call', async () => {
    await useCase.execute({
      domain: 'switch',
      service: 'toggle',
      entityId: 'switch.fan',
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Executing CallService use case',
      expect.objectContaining({
        domain: 'switch',
        service: 'toggle',
      })
    );
  });
});
