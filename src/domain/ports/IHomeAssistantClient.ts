import type {
  HAIncomingMessage,
  HAOutgoingCommand,
  HAResultMessage,
  HAEventMessage,
} from '../entities/HomeAssistantMessage.js';
import type { EntityState } from '../entities/Entity.js';

/**
 * Connection state of the WebSocket client
 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'error';

/**
 * Event handler types
 */
export type MessageHandler = (message: HAIncomingMessage) => void;
export type EventHandler = (event: HAEventMessage) => void;
export type StateChangeHandler = (
  entityId: string,
  oldState: EntityState | null,
  newState: EntityState
) => void;
export type ConnectionStateHandler = (state: ConnectionState) => void;

/**
 * Port interface for Home Assistant WebSocket client
 * This is the contract that infrastructure must implement
 */
export interface IHomeAssistantClient {
  /**
   * Current connection state
   */
  readonly connectionState: ConnectionState;

  /**
   * Home Assistant version (available after connection)
   */
  readonly haVersion: string | null;

  /**
   * Connect to Home Assistant
   */
  connect(): Promise<void>;

  /**
   * Disconnect from Home Assistant
   */
  disconnect(): Promise<void>;

  /**
   * Send a command and wait for result
   */
  sendCommand<T = unknown>(command: HAOutgoingCommand): Promise<HAResultMessage & { result: T }>;

  /**
   * Subscribe to all events or specific event type
   */
  subscribeEvents(eventType?: string): Promise<number>;

  /**
   * Unsubscribe from events
   */
  unsubscribeEvents(subscriptionId: number): Promise<void>;

  /**
   * Get all entity states
   */
  getStates(): Promise<EntityState[]>;

  /**
   * Get Home Assistant configuration
   */
  getConfig(): Promise<Record<string, unknown>>;

  /**
   * Get available services
   */
  getServices(): Promise<Record<string, unknown>>;

  /**
   * Call a service
   */
  callService(
    domain: string,
    service: string,
    data?: Record<string, unknown>,
    target?: {
      entity_id?: string | string[];
      device_id?: string | string[];
      area_id?: string | string[];
    }
  ): Promise<HAResultMessage>;

  /**
   * Send a ping to keep connection alive
   */
  ping(): Promise<void>;

  /**
   * Register event handlers
   */
  onMessage(handler: MessageHandler): void;
  onEvent(handler: EventHandler): void;
  onStateChange(handler: StateChangeHandler): void;
  onConnectionStateChange(handler: ConnectionStateHandler): void;

  /**
   * Remove event handlers
   */
  offMessage(handler: MessageHandler): void;
  offEvent(handler: EventHandler): void;
  offStateChange(handler: StateChangeHandler): void;
  offConnectionStateChange(handler: ConnectionStateHandler): void;
}
