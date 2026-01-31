import type { IHomeAssistantClient } from '../../domain/ports/IHomeAssistantClient.js';
import type { ILogger } from '../../domain/ports/ILogger.js';
import type { AgentResponse } from '../../domain/entities/AgentIntent.js';

export interface ProcessConversationInput {
  text: string;
  conversationId?: string;
  language?: string;
}

export interface ProcessConversationOutput {
  response: AgentResponse;
  conversationId: string;
}

/**
 * Use case for processing conversation through Home Assistant's conversation API
 */
export class ProcessConversation {
  constructor(
    private readonly haClient: IHomeAssistantClient,
    private readonly logger: ILogger
  ) {}

  async execute(input: ProcessConversationInput): Promise<ProcessConversationOutput> {
    this.logger.info('Executing ProcessConversation use case', {
      text: input.text,
      conversationId: input.conversationId,
    });

    if (!input.text || input.text.trim().length === 0) {
      throw new Error('Text input is required');
    }

    try {
      const result = await this.haClient.sendCommand<{
        response: {
          speech: {
            plain: {
              speech: string;
            };
          };
        };
        conversation_id: string;
      }>({
        type: 'conversation/process',
        text: input.text.trim(),
        ...(input.conversationId && { conversation_id: input.conversationId }),
        ...(input.language && { language: input.language }),
      });

      const conversationResult = result.result;
      const speech = conversationResult.response?.speech?.plain?.speech ?? 'No response';

      this.logger.info('Conversation processed', {
        conversationId: conversationResult.conversation_id,
        response: speech,
      });

      return {
        response: {
          speech,
          conversationId: conversationResult.conversation_id,
        },
        conversationId: conversationResult.conversation_id,
      };
    } catch (error) {
      this.logger.error('Error processing conversation', error);
      throw error;
    }
  }
}
