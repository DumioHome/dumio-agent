import type { AgentResponse, ConversationContext } from '../entities/AgentIntent.js';

/**
 * Port interface for conversation/agent service
 */
export interface IConversationService {
  /**
   * Process a text input and return agent response
   */
  processText(
    text: string,
    conversationId?: string,
    language?: string
  ): Promise<AgentResponse>;

  /**
   * Get conversation context
   */
  getConversation(conversationId: string): ConversationContext | undefined;

  /**
   * Clear conversation context
   */
  clearConversation(conversationId: string): void;

  /**
   * List active conversations
   */
  listConversations(): ConversationContext[];
}
