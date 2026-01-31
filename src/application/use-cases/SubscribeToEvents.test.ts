import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubscribeToEvents } from './SubscribeToEvents.js';
import type { IHomeAssistantClient } from '../../domain/ports/IHomeAssistantClient.js';
import type { ILogger } from '../../domain/ports/ILogger.js';

describe('SubscribeToEvents', () => {
  let mockHaClient: IHomeAssistantClient;
  let mockLogger: ILogger;
  let useCase: SubscribeToEvents;

  beforeEach(() => {
    mockHaClient = {
      connectionState: 'connected',
      haVersion: '2024.1.0',
      connect: vi.fn(),
      disconnect: vi.fn(),
      sendCommand: vi.fn(),
      subscribeEvents: vi.fn().mockResolvedValue(42),
      unsubscribeEvents: vi.fn().mockResolvedValue(undefined),
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

    useCase = new SubscribeToEvents(mockHaClient, mockLogger);
  });

  it('should subscribe to all events when no event type specified', async () => {
    const result = await useCase.execute();

    expect(mockHaClient.subscribeEvents).toHaveBeenCalledWith(undefined);
    expect(result.subscriptionId).toBe(42);
  });

  it('should subscribe to specific event type', async () => {
    const result = await useCase.execute({ eventType: 'state_changed' });

    expect(mockHaClient.subscribeEvents).toHaveBeenCalledWith('state_changed');
    expect(result.subscriptionId).toBe(42);
  });

  it('should register event handler when provided', async () => {
    const eventHandler = vi.fn();
    await useCase.execute({ onEvent: eventHandler });

    expect(mockHaClient.onEvent).toHaveBeenCalledWith(eventHandler);
  });

  it('should register state change handler when provided', async () => {
    const stateChangeHandler = vi.fn();
    await useCase.execute({ onStateChange: stateChangeHandler });

    expect(mockHaClient.onStateChange).toHaveBeenCalledWith(stateChangeHandler);
  });

  it('should return unsubscribe function', async () => {
    const eventHandler = vi.fn();
    const stateChangeHandler = vi.fn();

    const result = await useCase.execute({
      onEvent: eventHandler,
      onStateChange: stateChangeHandler,
    });

    expect(typeof result.unsubscribe).toBe('function');

    // Call unsubscribe
    await result.unsubscribe();

    expect(mockHaClient.offEvent).toHaveBeenCalledWith(eventHandler);
    expect(mockHaClient.offStateChange).toHaveBeenCalledWith(stateChangeHandler);
    expect(mockHaClient.unsubscribeEvents).toHaveBeenCalledWith(42);
  });

  it('should handle errors during subscription', async () => {
    const error = new Error('Subscription failed');
    mockHaClient.subscribeEvents = vi.fn().mockRejectedValue(error);

    await expect(useCase.execute()).rejects.toThrow('Subscription failed');
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('should log subscription info', async () => {
    await useCase.execute({ eventType: 'call_service' });

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Executing SubscribeToEvents use case',
      expect.objectContaining({ eventType: 'call_service' })
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Subscribed to events',
      expect.objectContaining({ subscriptionId: 42, eventType: 'call_service' })
    );
  });

  it('should log unsubscription', async () => {
    const result = await useCase.execute();
    await result.unsubscribe();

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Unsubscribed from events',
      expect.objectContaining({ subscriptionId: 42 })
    );
  });
});
