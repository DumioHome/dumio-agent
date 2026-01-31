import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetEntityState } from './GetEntityState.js';
import type { IHomeAssistantClient } from '../../domain/ports/IHomeAssistantClient.js';
import type { ILogger } from '../../domain/ports/ILogger.js';
import type { EntityState } from '../../domain/entities/Entity.js';

describe('GetEntityState', () => {
  let mockHaClient: IHomeAssistantClient;
  let mockLogger: ILogger;
  let useCase: GetEntityState;
  let mockStates: EntityState[];

  beforeEach(() => {
    mockStates = [
      {
        entity_id: 'light.living_room',
        state: 'on',
        attributes: { brightness: 255, friendly_name: 'Living Room' },
        last_changed: '2024-01-01T00:00:00Z',
        last_updated: '2024-01-01T00:00:00Z',
        context: { id: '1', parent_id: null, user_id: null },
      },
      {
        entity_id: 'light.bedroom',
        state: 'off',
        attributes: { friendly_name: 'Bedroom' },
        last_changed: '2024-01-01T00:00:00Z',
        last_updated: '2024-01-01T00:00:00Z',
        context: { id: '2', parent_id: null, user_id: null },
      },
      {
        entity_id: 'switch.fan',
        state: 'on',
        attributes: { friendly_name: 'Fan' },
        last_changed: '2024-01-01T00:00:00Z',
        last_updated: '2024-01-01T00:00:00Z',
        context: { id: '3', parent_id: null, user_id: null },
      },
      {
        entity_id: 'sensor.temperature',
        state: '22.5',
        attributes: { unit_of_measurement: '°C' },
        last_changed: '2024-01-01T00:00:00Z',
        last_updated: '2024-01-01T00:00:00Z',
        context: { id: '4', parent_id: null, user_id: null },
      },
    ];

    mockHaClient = {
      connectionState: 'connected',
      haVersion: '2024.1.0',
      connect: vi.fn(),
      disconnect: vi.fn(),
      sendCommand: vi.fn(),
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

    useCase = new GetEntityState(mockHaClient, mockLogger);
  });

  it('should return all states when no filter is provided', async () => {
    const result = await useCase.execute();

    expect(mockHaClient.getStates).toHaveBeenCalled();
    expect(result.entities).toHaveLength(4);
    expect(result.count).toBe(4);
  });

  it('should filter by specific entity ID', async () => {
    const result = await useCase.execute({ entityId: 'light.living_room' });

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entity_id).toBe('light.living_room');
  });

  it('should filter by domain', async () => {
    const result = await useCase.execute({
      filter: { domain: 'light' },
    });

    expect(result.entities).toHaveLength(2);
    expect(result.entities.every((e) => e.entity_id.startsWith('light.'))).toBe(true);
  });

  it('should filter by state value', async () => {
    const result = await useCase.execute({
      filter: { stateEquals: 'on' },
    });

    expect(result.entities).toHaveLength(2);
    expect(result.entities.every((e) => e.state === 'on')).toBe(true);
  });

  it('should filter by multiple entity IDs', async () => {
    const result = await useCase.execute({
      filter: { entityIds: ['light.living_room', 'switch.fan'] },
    });

    expect(result.entities).toHaveLength(2);
  });

  it('should filter by attribute', async () => {
    const result = await useCase.execute({
      filter: {
        attributeFilter: { key: 'brightness', value: 255 },
      },
    });

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entity_id).toBe('light.living_room');
  });

  it('should combine domain and state filters', async () => {
    const result = await useCase.execute({
      filter: {
        domain: 'light',
        stateEquals: 'off',
      },
    });

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entity_id).toBe('light.bedroom');
  });

  it('should return empty array when no matches found', async () => {
    const result = await useCase.execute({ entityId: 'light.non_existent' });

    expect(result.entities).toHaveLength(0);
    expect(result.count).toBe(0);
  });

  it('should handle errors', async () => {
    const error = new Error('Connection lost');
    mockHaClient.getStates = vi.fn().mockRejectedValue(error);

    await expect(useCase.execute()).rejects.toThrow('Connection lost');
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
