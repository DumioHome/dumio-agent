import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectToHomeAssistant } from './ConnectToHomeAssistant.js';
import type { IHomeAssistantClient } from '../../domain/ports/IHomeAssistantClient.js';
import type { ILogger } from '../../domain/ports/ILogger.js';

describe('ConnectToHomeAssistant', () => {
  let mockHaClient: IHomeAssistantClient;
  let mockLogger: ILogger;
  let useCase: ConnectToHomeAssistant;

  beforeEach(() => {
    mockHaClient = {
      connectionState: 'disconnected',
      haVersion: '2024.1.0',
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      sendCommand: vi.fn(),
      subscribeEvents: vi.fn().mockResolvedValue(1),
      unsubscribeEvents: vi.fn().mockResolvedValue(undefined),
      getStates: vi.fn().mockResolvedValue([
        { entity_id: 'light.living_room', state: 'on', attributes: {}, last_changed: '', last_updated: '', context: { id: '', parent_id: null, user_id: null } },
        { entity_id: 'switch.bedroom', state: 'off', attributes: {}, last_changed: '', last_updated: '', context: { id: '', parent_id: null, user_id: null } },
      ]),
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

    useCase = new ConnectToHomeAssistant(mockHaClient, mockLogger);
  });

  it('should connect to Home Assistant successfully', async () => {
    const result = await useCase.execute();

    expect(mockHaClient.connect).toHaveBeenCalled();
    expect(result.connected).toBe(true);
    expect(result.haVersion).toBe('2024.1.0');
  });

  it('should subscribe to state changes when requested', async () => {
    const result = await useCase.execute({ subscribeToStateChanges: true });

    expect(mockHaClient.subscribeEvents).toHaveBeenCalledWith('state_changed');
    expect(mockHaClient.getStates).toHaveBeenCalled();
    expect(result.entityCount).toBe(2);
  });

  it('should not subscribe to state changes when not requested', async () => {
    await useCase.execute({ subscribeToStateChanges: false });

    expect(mockHaClient.subscribeEvents).not.toHaveBeenCalled();
    expect(mockHaClient.getStates).not.toHaveBeenCalled();
  });

  it('should throw error when connection fails', async () => {
    const connectionError = new Error('Connection refused');
    mockHaClient.connect = vi.fn().mockRejectedValue(connectionError);

    await expect(useCase.execute()).rejects.toThrow('Connection refused');
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('should log info when executing', async () => {
    await useCase.execute();

    expect(mockLogger.info).toHaveBeenCalledWith('Executing ConnectToHomeAssistant use case');
  });
});
