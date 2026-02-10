import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpdateEntityName } from './UpdateEntityName.js';
import type { IHomeAssistantClient } from '../../domain/ports/IHomeAssistantClient.js';
import type { ILogger } from '../../domain/ports/ILogger.js';

describe('UpdateEntityName', () => {
  let mockHaClient: IHomeAssistantClient;
  let mockLogger: ILogger;
  let useCase: UpdateEntityName;

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

    useCase = new UpdateEntityName(mockHaClient, mockLogger);
  });

  it('should update entity name successfully', async () => {
    const result = await useCase.execute({
      entityId: 'switch.tecla_tokyo_un_canal_macroled_interruptor_1',
      name: 'Vestidor Interruptor 1',
    });

    expect(mockHaClient.sendCommand).toHaveBeenCalledWith({
      type: 'config/entity_registry/update',
      entity_id: 'switch.tecla_tokyo_un_canal_macroled_interruptor_1',
      name: 'Vestidor Interruptor 1',
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain('successfully');
    expect(result.message).toContain('Vestidor Interruptor 1');
  });

  it('should trim whitespace from name', async () => {
    const result = await useCase.execute({
      entityId: 'light.living_room',
      name: '  Sala de Estar  ',
    });

    expect(mockHaClient.sendCommand).toHaveBeenCalledWith({
      type: 'config/entity_registry/update',
      entity_id: 'light.living_room',
      name: 'Sala de Estar',
    });
    expect(result.success).toBe(true);
  });

  it('should fail when entityId is missing', async () => {
    const result = await useCase.execute({
      entityId: '',
      name: 'Test Name',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Missing entityId');
    expect(mockHaClient.sendCommand).not.toHaveBeenCalled();
  });

  it('should fail when name is missing', async () => {
    const result = await useCase.execute({
      entityId: 'switch.test',
      name: '',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Missing name');
    expect(mockHaClient.sendCommand).not.toHaveBeenCalled();
  });

  it('should fail when name is only whitespace', async () => {
    const result = await useCase.execute({
      entityId: 'switch.test',
      name: '   ',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Missing name');
    expect(mockHaClient.sendCommand).not.toHaveBeenCalled();
  });

  it('should handle Home Assistant API errors', async () => {
    mockHaClient.sendCommand = vi.fn().mockResolvedValue({
      success: false,
      error: { 
        code: 'not_found', 
        message: 'Entity not found' 
      },
      id: 1,
      type: 'result',
    });

    const result = await useCase.execute({
      entityId: 'switch.nonexistent',
      name: 'Test Name',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Entity not found');
    expect(result.message).toContain('Failed to update entity name');
  });

  it('should log the command being sent', async () => {
    await useCase.execute({
      entityId: 'light.bedroom',
      name: 'Dormitorio',
    });

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Sending entity registry update command',
      expect.objectContaining({
        entityId: 'light.bedroom',
        name: 'Dormitorio',
      })
    );
  });

  it('should log success message', async () => {
    await useCase.execute({
      entityId: 'switch.test',
      name: 'Test Switch',
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Entity name updated successfully',
      expect.objectContaining({
        entityId: 'switch.test',
        name: 'Test Switch',
      })
    );
  });

  it('should log error details on failure', async () => {
    mockHaClient.sendCommand = vi.fn().mockResolvedValue({
      success: false,
      error: { 
        code: 'invalid_format', 
        message: 'Invalid entity ID format' 
      },
      id: 1,
      type: 'result',
    });

    await useCase.execute({
      entityId: 'invalid.entity',
      name: 'Test',
    });

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Entity registry update failed',
      expect.objectContaining({
        entityId: 'invalid.entity',
        error: 'Invalid entity ID format',
        errorCode: 'invalid_format',
      })
    );
  });

  it('should handle exceptions gracefully', async () => {
    mockHaClient.sendCommand = vi.fn().mockRejectedValue(
      new Error('Network error')
    );

    const result = await useCase.execute({
      entityId: 'switch.test',
      name: 'Test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Network error');
    expect(mockLogger.error).toHaveBeenCalledWith(
      'UpdateEntityName failed',
      expect.objectContaining({
        entityId: 'switch.test',
        name: 'Test',
        error: 'Network error',
      })
    );
  });
});
