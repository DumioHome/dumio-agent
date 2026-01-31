import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessConversation } from './ProcessConversation.js';
import type { IHomeAssistantClient } from '../../domain/ports/IHomeAssistantClient.js';
import type { ILogger } from '../../domain/ports/ILogger.js';

describe('ProcessConversation', () => {
  let mockHaClient: IHomeAssistantClient;
  let mockLogger: ILogger;
  let useCase: ProcessConversation;

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
        result: {
          response: {
            speech: {
              plain: {
                speech: 'Turned on the living room light',
              },
            },
          },
          conversation_id: 'conv-123',
        },
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

    useCase = new ProcessConversation(mockHaClient, mockLogger);
  });

  it('should process conversation successfully', async () => {
    const result = await useCase.execute({
      text: 'Turn on the living room light',
    });

    expect(mockHaClient.sendCommand).toHaveBeenCalledWith({
      type: 'conversation/process',
      text: 'Turn on the living room light',
    });
    expect(result.response.speech).toBe('Turned on the living room light');
    expect(result.conversationId).toBe('conv-123');
  });

  it('should include conversation ID when provided', async () => {
    await useCase.execute({
      text: 'And the bedroom too',
      conversationId: 'conv-123',
    });

    expect(mockHaClient.sendCommand).toHaveBeenCalledWith({
      type: 'conversation/process',
      text: 'And the bedroom too',
      conversation_id: 'conv-123',
    });
  });

  it('should include language when provided', async () => {
    await useCase.execute({
      text: 'Enciende la luz',
      language: 'es',
    });

    expect(mockHaClient.sendCommand).toHaveBeenCalledWith({
      type: 'conversation/process',
      text: 'Enciende la luz',
      language: 'es',
    });
  });

  it('should throw error when text is empty', async () => {
    await expect(useCase.execute({ text: '' })).rejects.toThrow('Text input is required');
  });

  it('should throw error when text is only whitespace', async () => {
    await expect(useCase.execute({ text: '   ' })).rejects.toThrow('Text input is required');
  });

  it('should trim text before sending', async () => {
    await useCase.execute({ text: '  Turn on the light  ' });

    expect(mockHaClient.sendCommand).toHaveBeenCalledWith({
      type: 'conversation/process',
      text: 'Turn on the light',
    });
  });

  it('should handle response without speech', async () => {
    mockHaClient.sendCommand = vi.fn().mockResolvedValue({
      success: true,
      id: 1,
      type: 'result',
      result: {
        response: {},
        conversation_id: 'conv-456',
      },
    });

    const result = await useCase.execute({ text: 'Hello' });

    expect(result.response.speech).toBe('No response');
  });

  it('should handle errors', async () => {
    const error = new Error('Conversation processing failed');
    mockHaClient.sendCommand = vi.fn().mockRejectedValue(error);

    await expect(useCase.execute({ text: 'Test' })).rejects.toThrow('Conversation processing failed');
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('should log conversation processing', async () => {
    await useCase.execute({ text: 'Turn on light', conversationId: 'conv-789' });

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Executing ProcessConversation use case',
      expect.objectContaining({
        text: 'Turn on light',
        conversationId: 'conv-789',
      })
    );
  });
});
