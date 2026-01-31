/**
 * Represents an intent that the agent can process
 */
export interface AgentIntent {
  id: string;
  name: string;
  slots: Record<string, unknown>;
  confidence: number;
}

/**
 * Represents an agent response
 */
export interface AgentResponse {
  speech: string;
  action?: AgentAction;
  conversationId?: string;
}

/**
 * Action that the agent can perform
 */
export interface AgentAction {
  type: 'call_service' | 'get_state' | 'conversation';
  domain?: string;
  service?: string;
  entityId?: string;
  data?: Record<string, unknown>;
}

/**
 * Conversation context for multi-turn dialogs
 */
export interface ConversationContext {
  conversationId: string;
  language: string;
  lastIntent?: AgentIntent;
  entities: string[];
  startedAt: Date;
  lastActivityAt: Date;
}
