import { io, Socket } from 'socket.io-client';
import type {
  ICloudClient,
  CloudConnectionState,
  AgentHealthData,
  CloudEventMap,
  CloudResponseMap,
} from '../../domain/ports/ICloudClient.js';
import type { ILogger } from '../../domain/ports/ILogger.js';

export interface CloudClientConfig {
  socketUrl: string;
  apiKey: string;
  agentId: string;
  reconnection?: boolean;
  reconnectionAttempts?: number;
  reconnectionDelay?: number;
}

/**
 * Socket.IO client for cloud communication
 */
export class CloudClient implements ICloudClient {
  private socket: Socket | null = null;
  private _connectionState: CloudConnectionState = 'disconnected';
  private connectionStateHandlers: Array<(state: CloudConnectionState) => void> = [];
  private healthInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: CloudClientConfig,
    private readonly logger: ILogger
  ) {
    this.logger.info('CloudClient initialized', {
      socketUrl: config.socketUrl,
      agentId: config.agentId,
    });
  }

  get connectionState(): CloudConnectionState {
    return this._connectionState;
  }

  private setConnectionState(state: CloudConnectionState): void {
    if (this._connectionState !== state) {
      this._connectionState = state;
      this.connectionStateHandlers.forEach((handler) => handler(state));
      this.logger.info('Cloud connection state changed', { state });
    }
  }

  async connect(): Promise<void> {
    if (this.socket?.connected) {
      this.logger.debug('Already connected to cloud');
      return;
    }

    this.setConnectionState('connecting');

    return new Promise((resolve, reject) => {
      try {
        this.socket = io(this.config.socketUrl, {
          auth: {
            apiKey: this.config.apiKey,
            agentId: this.config.agentId,
          },
          reconnection: this.config.reconnection ?? true,
          reconnectionAttempts: this.config.reconnectionAttempts ?? 10,
          reconnectionDelay: this.config.reconnectionDelay ?? 5000,
          timeout: 10000,
          transports: ['websocket', 'polling'],
        });

        this.socket.on('connect', () => {
          this.logger.info('Connected to cloud', {
            socketId: this.socket?.id,
            agentId: this.config.agentId,
          });
          this.setConnectionState('connected');
          resolve();
        });

        this.socket.on('disconnect', (reason) => {
          this.logger.warn('Disconnected from cloud', { reason });
          this.setConnectionState('disconnected');
        });

        this.socket.on('connect_error', (error) => {
          this.logger.error('Cloud connection error', { error: error.message });
          this.setConnectionState('error');
          if (this._connectionState === 'connecting') {
            reject(error);
          }
        });

        this.socket.on('reconnect', (attemptNumber) => {
          this.logger.info('Reconnected to cloud', { attemptNumber });
          this.setConnectionState('connected');
        });

        this.socket.on('reconnect_attempt', (attemptNumber) => {
          this.logger.debug('Attempting to reconnect to cloud', { attemptNumber });
          this.setConnectionState('connecting');
        });

        this.socket.on('reconnect_failed', () => {
          this.logger.error('Failed to reconnect to cloud after max attempts');
          this.setConnectionState('error');
        });

        // Handle incoming events from cloud
        this.setupCloudEventHandlers();
      } catch (error) {
        this.setConnectionState('error');
        reject(error);
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.setConnectionState('disconnected');
      this.logger.info('Disconnected from cloud');
    }
  }

  sendHealth(data: AgentHealthData): void {
    if (!this.socket?.connected) {
      this.logger.debug('Cannot send health: not connected to cloud');
      return;
    }

    this.socket.emit('health:update', data);
    this.logger.debug('Health data sent to cloud', {
      dumioDeviceId: data.dumioDeviceId,
      status: data.status,
      haConnected: data.homeAssistant.connected,
    });
  }

  emit<K extends keyof CloudResponseMap>(event: K, data: CloudResponseMap[K]): void {
    if (!this.socket?.connected) {
      this.logger.debug('Cannot emit: not connected to cloud', { event });
      return;
    }

    this.socket.emit(event, data);
    this.logger.debug('Event emitted to cloud', { event });
  }

  on<K extends keyof CloudEventMap>(event: K, handler: (data: CloudEventMap[K]) => void): void {
    if (!this.socket) {
      this.logger.warn('Cannot register handler: socket not initialized', { event });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.socket.on(event as string, handler as any);
  }

  off<K extends keyof CloudEventMap>(event: K, handler: (data: CloudEventMap[K]) => void): void {
    if (!this.socket) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.socket.off(event as string, handler as any);
  }

  onConnectionStateChange(handler: (state: CloudConnectionState) => void): void {
    this.connectionStateHandlers.push(handler);
  }

  /**
   * Start periodic health reporting
   */
  startHealthReporting(
    getHealthData: () => Promise<AgentHealthData>,
    intervalMs: number = 30000
  ): void {
    // Send initial health
    getHealthData().then((data) => this.sendHealth(data));

    // Set up periodic reporting
    this.healthInterval = setInterval(async () => {
      try {
        const data = await getHealthData();
        this.sendHealth(data);
      } catch (error) {
        this.logger.error('Failed to get health data', { error });
      }
    }, intervalMs);

    this.logger.info('Health reporting started', { intervalMs });
  }

  private setupCloudEventHandlers(): void {
    if (!this.socket) return;

    // Handle health request from cloud
    this.socket.on('health:request', () => {
      this.logger.debug('Health request received from cloud');
      // This will be handled by the registered handler in the application layer
    });

    // Handle command execution request from cloud
    this.socket.on('command:execute', (data: CloudEventMap['command:execute']) => {
      this.logger.debug('Command received from cloud', { command: data.command });
      // This will be handled by the registered handler in the application layer
    });

    // Handle devices request from cloud
    this.socket.on('devices:request', (data: CloudEventMap['devices:request']) => {
      this.logger.debug('Devices request received from cloud', { filter: data.filter });
      // This will be handled by the registered handler in the application layer
    });

    // Handle rooms request from cloud
    this.socket.on('rooms:request', () => {
      this.logger.debug('Rooms request received from cloud');
      // This will be handled by the registered handler in the application layer
    });

    // Handle any custom events
    this.socket.onAny((event, ...args) => {
      this.logger.trace('Cloud event received', { event, args });
    });
  }
}
