import { io, Socket } from "socket.io-client";
import type {
  ICloudClient,
  CloudConnectionState,
  AgentHealthData,
  CloudEventMap,
  CloudResponseMap,
  CloudEmitWithCallbackMap,
} from "../../domain/ports/ICloudClient.js";
import type { ILogger } from "../../domain/ports/ILogger.js";

export interface CloudClientConfig {
  socketUrl: string;
  apiKey: string;
  agentId: string;
  reconnection?: boolean;
  reconnectionAttempts?: number;
  reconnectionDelay?: number;
  /** Si no hay actividad (mensaje recibido) en este tiempo (ms), se fuerza reconexión. Por defecto 45s. */
  activityTimeoutMs?: number;
}

/**
 * Socket.IO client for cloud communication
 */
export class CloudClient implements ICloudClient {
  private socket: Socket | null = null;
  private _connectionState: CloudConnectionState = "disconnected";
  private connectionStateHandlers: Array<
    (state: CloudConnectionState) => void
  > = [];
  private healthInterval: NodeJS.Timeout | null = null;
  /** Timeout de actividad: si no llega ningún mensaje en N ms, se fuerza reconexión (evita conexiones zombie). */
  private activityCheckInterval: NodeJS.Timeout | null = null;
  private lastActivityAt = 0;

  // Smart health reporting - only send when changes detected
  private lastHealthData: AgentHealthData | null = null;
  private lastHealthHash: string = "";

  constructor(
    private readonly config: CloudClientConfig,
    private readonly logger: ILogger
  ) {
    this.logger.info("CloudClient initialized", {
      socketUrl: config.socketUrl,
      agentId: config.agentId,
    });
  }

  /**
   * Generate a hash of the health data for comparison
   */
  private hashHealthData(data: AgentHealthData): string {
    // Only hash the fields that matter for detecting changes
    return JSON.stringify({
      status: data.status,
      haConnected: data.homeAssistant.connected,
      entityCount: data.homeAssistant.entityCount,
      deviceCount: data.homeAssistant.deviceCount,
    });
  }

  /**
   * Check if health data has changed
   */
  private hasHealthChanged(data: AgentHealthData): boolean {
    const newHash = this.hashHealthData(data);
    if (newHash !== this.lastHealthHash) {
      this.lastHealthHash = newHash;
      this.lastHealthData = data;
      return true;
    }
    return false;
  }

  get connectionState(): CloudConnectionState {
    return this._connectionState;
  }

  private setConnectionState(state: CloudConnectionState): void {
    if (this._connectionState !== state) {
      this._connectionState = state;
      this.connectionStateHandlers.forEach((handler) => handler(state));
      this.logger.info("Cloud connection state changed", { state });
    }
  }

  async connect(): Promise<void> {
    if (this.socket?.connected) {
      this.logger.debug("Already connected to cloud");
      return;
    }

    this.setConnectionState("connecting");

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
          transports: ["websocket", "polling"],
        });

        this.socket.on("connect", () => {
          this.touchActivity();
          this.startActivityCheck();
          this.logger.info("Connected to cloud", {
            socketId: this.socket?.id,
            agentId: this.config.agentId,
          });
          this.setConnectionState("connected");
          resolve();
        });

        this.socket.on("disconnect", (reason) => {
          this.logger.warn("Disconnected from cloud", { reason });
          this.stopActivityCheck();
          this.setConnectionState("disconnected");
        });

        this.socket.on("connect_error", (error) => {
          this.logger.error("Cloud connection error", { error: error.message });
          this.setConnectionState("error");
          if (this._connectionState === "connecting") {
            reject(error);
          }
        });

        this.socket.on("reconnect", (attemptNumber) => {
          this.touchActivity();
          this.startActivityCheck();
          this.logger.info("Reconnected to cloud", { attemptNumber });
          this.setConnectionState("connected");
        });

        this.socket.on("reconnect_attempt", (attemptNumber) => {
          this.logger.debug("Attempting to reconnect to cloud", {
            attemptNumber,
          });
          this.setConnectionState("connecting");
        });

        this.socket.on("reconnect_failed", () => {
          this.logger.error("Failed to reconnect to cloud after max attempts");
          this.setConnectionState("error");
        });

        // Cualquier mensaje recibido cuenta como actividad (evita timeout en conexiones zombie)
        this.socket.onAny(() => {
          this.touchActivity();
        });

        // Handle incoming events from cloud
        this.setupCloudEventHandlers();
      } catch (error) {
        this.setConnectionState("error");
        reject(error);
      }
    });
  }

  private touchActivity(): void {
    this.lastActivityAt = Date.now();
  }

  private startActivityCheck(): void {
    this.stopActivityCheck();
    const timeoutMs = this.config.activityTimeoutMs ?? 45000;
    const checkIntervalMs = Math.min(5000, Math.floor(timeoutMs / 3));
    this.activityCheckInterval = setInterval(() => {
      if (!this.socket?.connected) return;
      const elapsed = Date.now() - this.lastActivityAt;
      if (elapsed >= timeoutMs) {
        this.logger.warn("heartbeat timeout → reconnecting", {
          elapsed,
          timeoutMs,
        });
        this.forceReconnect().catch((err) =>
          this.logger.error("Force reconnect after activity timeout failed", {
            err,
          })
        );
      }
    }, checkIntervalMs);
  }

  private stopActivityCheck(): void {
    if (this.activityCheckInterval) {
      clearInterval(this.activityCheckInterval);
      this.activityCheckInterval = null;
    }
  }

  /**
   * Cierra el socket actual y abre uno nuevo (reconexión explícita).
   * Usado ante timeout de actividad o errores; no depende de la app para reparar.
   */
  async forceReconnect(): Promise<void> {
    this.stopActivityCheck();
    if (!this.socket) return;

    this.logger.info("Force reconnect: closing current socket and reopening");
    const s = this.socket;
    this.socket = null;
    try {
      s.removeAllListeners();
      s.disconnect();
    } catch {
      // ignore
    }
    this.setConnectionState("disconnected");
    await this.connect();
  }

  async disconnect(): Promise<void> {
    this.stopActivityCheck();
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
      this.setConnectionState("disconnected");
      this.logger.info("Disconnected from cloud");
    }
  }

  sendHealth(data: AgentHealthData): void {
    if (!this.socket?.connected) {
      this.logger.debug("Cannot send health: not connected to cloud");
      return;
    }

    this.socket.emit("health:update", data);
    this.logger.debug("Health data sent to cloud", {
      dumioDeviceId: data.dumioDeviceId,
      status: data.status,
      haConnected: data.homeAssistant.connected,
    });
  }

  emit<K extends keyof CloudResponseMap>(
    event: K,
    data: CloudResponseMap[K]
  ): void {
    if (!this.socket?.connected) {
      this.logger.debug("Cannot emit: not connected to cloud", { event });
      return;
    }

    this.socket.emit(event, data);
    this.logger.debug("Event emitted to cloud", { event });
  }

  emitWithCallback<K extends keyof CloudEmitWithCallbackMap>(
    event: K,
    data: CloudEmitWithCallbackMap[K]["payload"],
    timeout: number = 30000
  ): Promise<CloudEmitWithCallbackMap[K]["response"]> {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        this.logger.debug("Cannot emit with callback: not connected to cloud", {
          event,
        });
        reject(new Error("Not connected to cloud"));
        return;
      }

      const timeoutId = setTimeout(() => {
        reject(new Error(`Timeout waiting for response to ${event}`));
      }, timeout);

      this.socket.emit(
        event,
        data,
        (response: CloudEmitWithCallbackMap[K]["response"]) => {
          clearTimeout(timeoutId);
          this.logger.debug("Received callback response from cloud", {
            event,
            success: response?.success,
          });
          resolve(response);
        }
      );

      this.logger.debug("Event emitted to cloud with callback", { event });
    });
  }

  on<K extends keyof CloudEventMap>(
    event: K,
    handler: (data: CloudEventMap[K]) => void
  ): void {
    if (!this.socket) {
      this.logger.warn("Cannot register handler: socket not initialized", {
        event,
      });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.socket.on(event as string, handler as any);
  }

  off<K extends keyof CloudEventMap>(
    event: K,
    handler: (data: CloudEventMap[K]) => void
  ): void {
    if (!this.socket) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.socket.off(event as string, handler as any);
  }

  onConnectionStateChange(
    handler: (state: CloudConnectionState) => void
  ): void {
    this.connectionStateHandlers.push(handler);
  }

  /**
   * Start smart health reporting - only sends when changes are detected
   */
  startHealthReporting(
    getHealthData: () => Promise<AgentHealthData>,
    intervalMs: number = 30000
  ): void {
    // Send initial health (always send first time)
    getHealthData().then((data) => {
      this.lastHealthHash = this.hashHealthData(data);
      this.lastHealthData = data;
      this.sendHealth(data);
      this.logger.info("Initial health data sent to cloud");
    });

    // Set up periodic check - only sends if changes detected
    this.healthInterval = setInterval(async () => {
      try {
        const data = await getHealthData();

        if (this.hasHealthChanged(data)) {
          this.sendHealth(data);
          this.logger.info("Health data changed, sent to cloud", {
            status: data.status,
            haConnected: data.homeAssistant.connected,
            entityCount: data.homeAssistant.entityCount,
          });
        } else {
          this.logger.debug("Health data unchanged, skipping send");
        }
      } catch (error) {
        this.logger.error("Failed to get health data", { error });
      }
    }, intervalMs);

    this.logger.info("Smart health reporting started", {
      intervalMs,
      description: "Only sends updates when changes are detected",
    });
  }

  /**
   * Force send health data (bypasses change detection)
   */
  forceSendHealth(data: AgentHealthData): void {
    this.lastHealthHash = this.hashHealthData(data);
    this.lastHealthData = data;
    this.sendHealth(data);
    this.logger.info("Health data force-sent to cloud");
  }

  private setupCloudEventHandlers(): void {
    if (!this.socket) return;

    // Handle health request from cloud
    this.socket.on("health:request", () => {
      this.logger.debug("Health request received from cloud");
      // This will be handled by the registered handler in the application layer
    });

    // Handle command execution request from cloud
    this.socket.on(
      "command:execute",
      (data: CloudEventMap["command:execute"]) => {
        this.logger.debug("Command received from cloud", {
          command: data.command,
        });
        // This will be handled by the registered handler in the application layer
      }
    );

    // Handle devices request from cloud
    this.socket.on(
      "devices:request",
      (data: CloudEventMap["devices:request"]) => {
        this.logger.debug("Devices request received from cloud", {
          filter: data.filter,
        });
        // This will be handled by the registered handler in the application layer
      }
    );

    // Handle rooms request from cloud
    this.socket.on("rooms:request", () => {
      this.logger.debug("Rooms request received from cloud");
      // This will be handled by the registered handler in the application layer
    });

    // Handle device control command from cloud
    this.socket.on(
      "device:control",
      (data: CloudEventMap["device:control"]) => {
        this.logger.debug("Device control command received from cloud", {
          deviceId: data.deviceId,
          capabilityType: data.capabilityType,
        });
        // This will be handled by the registered handler in the application layer
      }
    );

    // Handle capabilities updated event from cloud
    this.socket.on(
      "capabilities:updated",
      (data: CloudEventMap["capabilities:updated"]) => {
        this.logger.debug("Capabilities updated received from cloud", {
          deviceId: data.deviceId,
          entityId: data.entityId,
          capabilityType: data.capabilityType,
          source: data.source,
        });
        // This will be handled by the registered handler in the application layer
      }
    );

    // Handle device updated event from cloud
    this.socket.on(
      "device:updated",
      (data: CloudEventMap["device:updated"]) => {
        this.logger.debug("Device updated received from cloud", {
          id: data.id,
          deviceId: data.deviceId,
          name: data.name,
          deviceCategoryId: data.deviceCategoryId,
        });
        // This will be handled by the registered handler in the application layer
      }
    );

    // Handle any custom events
    this.socket.onAny((event, ...args) => {
      this.logger.trace("Cloud event received", { event, args });
    });
  }
}
