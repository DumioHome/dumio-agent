import WebSocket from 'ws';
import type {
  IHomeAssistantClient,
  ConnectionState,
  MessageHandler,
  EventHandler,
  StateChangeHandler,
  ConnectionStateHandler,
} from '../../domain/ports/IHomeAssistantClient.js';
import type {
  HAIncomingMessage,
  HAOutgoingCommand,
  HAResultMessage,
  HAEventMessage,
  HAAuthRequiredMessage,
} from '../../domain/entities/HomeAssistantMessage.js';
import type { EntityState } from '../../domain/entities/Entity.js';
import type { ILogger } from '../../domain/ports/ILogger.js';

interface PendingCommand {
  resolve: (value: HAResultMessage) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export interface HomeAssistantClientConfig {
  url: string;
  accessToken: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  commandTimeout?: number;
  pingInterval?: number;
}

/**
 * WebSocket client implementation for Home Assistant
 */
export class HomeAssistantClient implements IHomeAssistantClient {
  private ws: WebSocket | null = null;
  private _connectionState: ConnectionState = 'disconnected';
  private _haVersion: string | null = null;
  private messageId = 1;
  private pendingCommands = new Map<number, PendingCommand>();
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private entityStates = new Map<string, EntityState>();

  // Event handlers
  private messageHandlers = new Set<MessageHandler>();
  private eventHandlers = new Set<EventHandler>();
  private stateChangeHandlers = new Set<StateChangeHandler>();
  private connectionStateHandlers = new Set<ConnectionStateHandler>();

  constructor(
    private readonly config: HomeAssistantClientConfig,
    private readonly logger: ILogger
  ) {
    this.config = {
      reconnectInterval: 5000,
      maxReconnectAttempts: 10,
      commandTimeout: 30000,
      pingInterval: 30000,
      ...config,
    };
  }

  get connectionState(): ConnectionState {
    return this._connectionState;
  }

  get haVersion(): string | null {
    return this._haVersion;
  }

  private setConnectionState(state: ConnectionState): void {
    const previousState = this._connectionState;
    this._connectionState = state;
    if (previousState !== state) {
      this.logger.debug('Connection state changed', { from: previousState, to: state });
      this.connectionStateHandlers.forEach((handler) => handler(state));
    }
  }

  async connect(): Promise<void> {
    if (this._connectionState === 'connected' || this._connectionState === 'connecting') {
      this.logger.warn('Already connected or connecting');
      return;
    }

    return new Promise((resolve, reject) => {
      this.setConnectionState('connecting');
      this.logger.info('Connecting to Home Assistant', { url: this.config.url });

      try {
        this.ws = new WebSocket(this.config.url);

        this.ws.on('open', () => {
          this.logger.debug('WebSocket connection opened');
          this.reconnectAttempts = 0;
        });

        this.ws.on('message', (data) => {
          this.handleMessage(data.toString(), resolve, reject);
        });

        this.ws.on('close', (code, reason) => {
          this.logger.info('WebSocket closed', { code, reason: reason.toString() });
          this.handleDisconnect();
        });

        this.ws.on('error', (error) => {
          this.logger.error('WebSocket error', error);
          if (this._connectionState === 'connecting') {
            reject(error);
          }
          this.setConnectionState('error');
        });
      } catch (error) {
        this.logger.error('Failed to create WebSocket', error);
        this.setConnectionState('error');
        reject(error);
      }
    });
  }

  private handleMessage(
    data: string,
    connectResolve?: (value: void) => void,
    connectReject?: (error: Error) => void
  ): void {
    try {
      const message = JSON.parse(data) as HAIncomingMessage;
      this.logger.trace('Received message', { type: message.type });

      // Notify all message handlers
      this.messageHandlers.forEach((handler) => handler(message));

      switch (message.type) {
        case 'auth_required':
          this.handleAuthRequired(message as HAAuthRequiredMessage);
          break;

        case 'auth_ok':
          this._haVersion = message.ha_version ?? null;
          this.setConnectionState('connected');
          this.logger.info('Authentication successful', { haVersion: this._haVersion });
          this.startPingInterval();
          connectResolve?.();
          break;

        case 'auth_invalid':
          this.setConnectionState('error');
          const error = new Error(`Authentication failed: ${message.message}`);
          this.logger.error('Authentication failed', error);
          connectReject?.(error);
          break;

        case 'result':
          this.handleResult(message as HAResultMessage);
          break;

        case 'event':
          this.handleEvent(message as HAEventMessage);
          break;

        case 'pong':
          this.logger.trace('Pong received', { id: message.id });
          break;
      }
    } catch (error) {
      this.logger.error('Failed to parse message', error, { data });
    }
  }

  private handleAuthRequired(message: HAAuthRequiredMessage): void {
    this._haVersion = message.ha_version;
    this.setConnectionState('authenticating');
    this.logger.debug('Authentication required', { haVersion: message.ha_version });

    this.sendRaw({
      type: 'auth',
      access_token: this.config.accessToken,
    });
  }

  private handleResult(message: HAResultMessage): void {
    const pending = this.pendingCommands.get(message.id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingCommands.delete(message.id);

      if (message.success) {
        pending.resolve(message);
      } else {
        const error = new Error(
          message.error?.message ?? 'Unknown error'
        );
        pending.reject(error);
      }
    }
  }

  private handleEvent(message: HAEventMessage): void {
    // Notify event handlers
    this.eventHandlers.forEach((handler) => handler(message));

    // Handle state_changed events
    if (message.event.event_type === 'state_changed') {
      const data = message.event.data as {
        entity_id: string;
        old_state: EntityState | null;
        new_state: EntityState;
      };

      const oldState = this.entityStates.get(data.entity_id) ?? data.old_state;
      this.entityStates.set(data.entity_id, data.new_state);

      this.stateChangeHandlers.forEach((handler) =>
        handler(data.entity_id, oldState, data.new_state)
      );
    }
  }

  private handleDisconnect(): void {
    this.stopPingInterval();
    this.setConnectionState('disconnected');
    this.ws = null;

    // Reject all pending commands
    this.pendingCommands.forEach((pending) => {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    });
    this.pendingCommands.clear();

    // Attempt reconnection
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (
      this.reconnectAttempts >= (this.config.maxReconnectAttempts ?? 10)
    ) {
      this.logger.error('Max reconnection attempts reached');
      this.setConnectionState('error');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectInterval ?? 5000;

    this.logger.info('Scheduling reconnection', {
      attempt: this.reconnectAttempts,
      delay,
    });

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error) => {
        this.logger.error('Reconnection failed', error);
      });
    }, delay);
  }

  private startPingInterval(): void {
    this.stopPingInterval();
    this.pingTimer = setInterval(() => {
      this.ping().catch((error) => {
        this.logger.error('Ping failed', error);
      });
    }, this.config.pingInterval ?? 30000);
  }

  private stopPingInterval(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private sendRaw(data: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }
    this.ws.send(JSON.stringify(data));
  }

  async disconnect(): Promise<void> {
    this.logger.info('Disconnecting from Home Assistant');

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopPingInterval();
    this.reconnectAttempts = this.config.maxReconnectAttempts ?? 10; // Prevent reconnection

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setConnectionState('disconnected');
  }

  async sendCommand<T = unknown>(
    command: HAOutgoingCommand
  ): Promise<HAResultMessage & { result: T }> {
    if (this._connectionState !== 'connected') {
      throw new Error('Not connected to Home Assistant');
    }

    const id = this.messageId++;
    const commandWithId = { ...command, id };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(id);
        reject(new Error(`Command timeout: ${command.type}`));
      }, this.config.commandTimeout ?? 30000);

      this.pendingCommands.set(id, {
        resolve: resolve as (value: HAResultMessage) => void,
        reject,
        timeout,
      });

      try {
        this.sendRaw(commandWithId);
        this.logger.debug('Command sent', { id, type: command.type });
      } catch (error) {
        clearTimeout(timeout);
        this.pendingCommands.delete(id);
        reject(error);
      }
    });
  }

  async subscribeEvents(eventType?: string): Promise<number> {
    const command = {
      type: 'subscribe_events' as const,
      ...(eventType && { event_type: eventType }),
    };

    const result = await this.sendCommand(command);
    this.logger.info('Subscribed to events', { eventType, subscriptionId: result.id });
    return result.id;
  }

  async unsubscribeEvents(subscriptionId: number): Promise<void> {
    await this.sendCommand({
      type: 'unsubscribe_events',
      subscription: subscriptionId,
    } as HAOutgoingCommand);
    this.logger.info('Unsubscribed from events', { subscriptionId });
  }

  async getStates(): Promise<EntityState[]> {
    const result = await this.sendCommand<EntityState[]>({ type: 'get_states' });

    // Cache states
    if (Array.isArray(result.result)) {
      result.result.forEach((state) => {
        this.entityStates.set(state.entity_id, state);
      });
    }

    return result.result;
  }

  async getConfig(): Promise<Record<string, unknown>> {
    const result = await this.sendCommand<Record<string, unknown>>({ type: 'get_config' });
    return result.result;
  }

  async getServices(): Promise<Record<string, unknown>> {
    const result = await this.sendCommand<Record<string, unknown>>({ type: 'get_services' });
    return result.result;
  }

  async callService(
    domain: string,
    service: string,
    data?: Record<string, unknown>,
    target?: {
      entity_id?: string | string[];
      device_id?: string | string[];
      area_id?: string | string[];
    }
  ): Promise<HAResultMessage> {
    const command = {
      type: 'call_service' as const,
      domain,
      service,
      ...(data && { service_data: data }),
      ...(target && { target }),
    };

    this.logger.info('Calling service', { domain, service, target });
    return this.sendCommand(command);
  }

  async ping(): Promise<void> {
    const id = this.messageId++;
    this.sendRaw({ id, type: 'ping' });
    this.logger.trace('Ping sent', { id });
  }

  // Event handler registration
  onMessage(handler: MessageHandler): void {
    this.messageHandlers.add(handler);
  }

  onEvent(handler: EventHandler): void {
    this.eventHandlers.add(handler);
  }

  onStateChange(handler: StateChangeHandler): void {
    this.stateChangeHandlers.add(handler);
  }

  onConnectionStateChange(handler: ConnectionStateHandler): void {
    this.connectionStateHandlers.add(handler);
  }

  offMessage(handler: MessageHandler): void {
    this.messageHandlers.delete(handler);
  }

  offEvent(handler: EventHandler): void {
    this.eventHandlers.delete(handler);
  }

  offStateChange(handler: StateChangeHandler): void {
    this.stateChangeHandlers.delete(handler);
  }

  offConnectionStateChange(handler: ConnectionStateHandler): void {
    this.connectionStateHandlers.delete(handler);
  }
}
