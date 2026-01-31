/**
 * Represents the different message types in Home Assistant WebSocket API
 */
export type HAMessageType =
  | 'auth_required'
  | 'auth_ok'
  | 'auth_invalid'
  | 'result'
  | 'event'
  | 'pong';

/**
 * Base message structure from Home Assistant
 */
export interface HABaseMessage {
  type: HAMessageType;
  ha_version?: string;
}

/**
 * Authentication required message
 */
export interface HAAuthRequiredMessage extends HABaseMessage {
  type: 'auth_required';
  ha_version: string;
}

/**
 * Authentication success message
 */
export interface HAAuthOkMessage extends HABaseMessage {
  type: 'auth_ok';
  ha_version: string;
}

/**
 * Authentication invalid message
 */
export interface HAAuthInvalidMessage extends HABaseMessage {
  type: 'auth_invalid';
  message: string;
}

/**
 * Result message from a command
 */
export interface HAResultMessage extends HABaseMessage {
  type: 'result';
  id: number;
  success: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Event message from subscriptions
 */
export interface HAEventMessage extends HABaseMessage {
  type: 'event';
  id: number;
  event: {
    event_type: string;
    data: Record<string, unknown>;
    origin: string;
    time_fired: string;
    context: {
      id: string;
      parent_id: string | null;
      user_id: string | null;
    };
  };
}

/**
 * Pong response to ping
 */
export interface HAPongMessage extends HABaseMessage {
  type: 'pong';
  id: number;
}

/**
 * Union type for all incoming messages
 */
export type HAIncomingMessage =
  | HAAuthRequiredMessage
  | HAAuthOkMessage
  | HAAuthInvalidMessage
  | HAResultMessage
  | HAEventMessage
  | HAPongMessage;

/**
 * Command types that can be sent to Home Assistant
 */
export type HACommandType =
  | 'auth'
  | 'subscribe_events'
  | 'unsubscribe_events'
  | 'call_service'
  | 'get_states'
  | 'get_config'
  | 'get_services'
  | 'get_panels'
  | 'ping'
  | 'conversation/process';

/**
 * Base outgoing command structure
 */
export interface HABaseCommand {
  id?: number;
  type: HACommandType | string;
}

/**
 * Authentication command
 */
export interface HAAuthCommand {
  type: 'auth';
  access_token: string;
}

/**
 * Subscribe to events command
 */
export interface HASubscribeEventsCommand extends HABaseCommand {
  type: 'subscribe_events';
  event_type?: string;
}

/**
 * Call service command
 */
export interface HACallServiceCommand extends HABaseCommand {
  type: 'call_service';
  domain: string;
  service: string;
  service_data?: Record<string, unknown>;
  target?: {
    entity_id?: string | string[];
    device_id?: string | string[];
    area_id?: string | string[];
  };
}

/**
 * Conversation process command (for agent integration)
 */
export interface HAConversationCommand extends HABaseCommand {
  type: 'conversation/process';
  text: string;
  conversation_id?: string;
  language?: string;
}

/**
 * Ping command for keep-alive
 */
export interface HAPingCommand extends HABaseCommand {
  type: 'ping';
}

/**
 * Union type for all outgoing commands
 */
export type HAOutgoingCommand =
  | HAAuthCommand
  | HASubscribeEventsCommand
  | HACallServiceCommand
  | HAConversationCommand
  | HAPingCommand
  | HABaseCommand;
