import type { IManagedConnection, ConnectionHealthState } from "../../domain/ports/IManagedConnection.js";
import type { ConnectionState } from "../../domain/ports/IHomeAssistantClient.js";
import type { HomeAssistantClient } from "../websocket/HomeAssistantClient.js";

function mapHaStateToHealth(state: ConnectionState): ConnectionHealthState {
  switch (state) {
    case "connected":
      return "CONNECTED";
    case "connecting":
    case "authenticating":
      return "DEGRADED";
    case "disconnected":
    case "error":
    default:
      return "OFFLINE";
  }
}

/**
 * Adaptador que expone HomeAssistantClient como IManagedConnection.
 * El cliente ya implementa heartbeat (ping/pong), timeout y forceReconnect;
 * este adapter solo mapea estados y engancha callbacks de resync.
 */
export class ManagedHomeAssistantConnection implements IManagedConnection {
  readonly name = "homeassistant";
  private unhealthyHandlers: Array<() => void> = [];
  private reconnectedHandlers: Array<() => void | Promise<void>> = [];

  constructor(private readonly client: HomeAssistantClient) {
    this.client.onConnectionStateChange((state) => {
      if (state === "error") {
        this.unhealthyHandlers.forEach((h) => h());
      }
      if (state === "connected") {
        this.reconnectedHandlers.forEach((h) => {
          try {
            const p = h();
            if (p && typeof p.then === "function") p.catch(() => {});
          } catch {
            // ignore
          }
        });
      }
    });
  }

  getHealthState(): ConnectionHealthState {
    return mapHaStateToHealth(this.client.connectionState);
  }

  async start(): Promise<void> {
    await this.client.connect();
  }

  async stop(): Promise<void> {
    await this.client.disconnect();
  }

  async forceReconnect(): Promise<void> {
    await this.client.forceReconnect();
  }

  onUnhealthy(handler: () => void): void {
    this.unhealthyHandlers.push(handler);
  }

  onReconnected(handler: () => void | Promise<void>): void {
    this.reconnectedHandlers.push(handler);
  }
}
