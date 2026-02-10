import type {
  IManagedConnection,
  ConnectionHealthState,
} from "../domain/ports/IManagedConnection.js";
import type { ILogger } from "../domain/ports/ILogger.js";

export interface ManagedConnectionEntry {
  connection: IManagedConnection;
  /** Ejecutado tras reconexión exitosa (resync de estados, actualización de entidades) */
  resyncCallback?: () => void | Promise<void>;
}

/**
 * Gestiona múltiples conexiones persistentes con política única de healthcheck y
 * auto-reconnect. Ante conexión no saludable se fuerza reconexión; tras reconexión
 * se ejecuta el resync asociado. Preferimos reconectar de más antes que de menos.
 */
export class ConnectionManager {
  private readonly connections = new Map<string, ManagedConnectionEntry>();
  private readonly logger: ILogger;
  private started = false;

  constructor(logger: ILogger) {
    this.logger = logger.child({ component: "ConnectionManager" });
  }

  /**
   * Registra una conexión y opcionalmente un callback de resync tras reconexión.
   */
  register(
    name: string,
    connection: IManagedConnection,
    resyncCallback?: () => void | Promise<void>
  ): void {
    if (this.connections.has(name)) {
      this.logger.warn("Connection already registered, replacing", { name });
    }
    this.connections.set(name, { connection, resyncCallback });

    connection.onUnhealthy(() => {
      this.logger.info("Connection unhealthy → forcing reconnect", { name });
      connection.forceReconnect().catch((err) => {
        this.logger.error("Force reconnect failed", { name, error: err });
      });
    });

    connection.onReconnected(async () => {
      this.logger.info("Reconnected → resyncing state", { name });
      const entry = this.connections.get(name);
      if (entry?.resyncCallback) {
        try {
          await entry.resyncCallback();
          this.logger.info("Resync completed after reconnect", { name });
        } catch (err) {
          this.logger.error("Resync after reconnect failed", {
            name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    });
  }

  /** Inicia todas las conexiones registradas y sus healthchecks */
  async startAll(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.logger.info("Starting all managed connections", {
      count: this.connections.size,
      names: [...this.connections.keys()],
    });
    for (const [name, { connection }] of this.connections) {
      try {
        await connection.start();
        this.logger.debug("Connection started", { name });
      } catch (err) {
        this.logger.error("Failed to start connection", {
          name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /** Detiene todas las conexiones sin reconectar */
  async stopAll(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    for (const [name, { connection }] of this.connections) {
      try {
        await connection.stop();
        this.logger.debug("Connection stopped", { name });
      } catch (err) {
        this.logger.warn("Error stopping connection", {
          name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  getConnectionState(name: string): ConnectionHealthState | undefined {
    return this.connections.get(name)?.connection.getHealthState();
  }

  getAllStates(): Record<string, ConnectionHealthState> {
    const out: Record<string, ConnectionHealthState> = {};
    for (const [name, { connection }] of this.connections) {
      out[name] = connection.getHealthState();
    }
    return out;
  }
}
