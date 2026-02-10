import type { IManagedConnection, ConnectionHealthState } from "../../domain/ports/IManagedConnection.js";
import type { CloudConnectionState } from "../../domain/ports/ICloudClient.js";
import type { CloudClient } from "../cloud/CloudClient.js";

function mapCloudStateToHealth(state: CloudConnectionState): ConnectionHealthState {
  switch (state) {
    case "connected":
      return "CONNECTED";
    case "connecting":
      return "DEGRADED";
    case "disconnected":
    case "error":
    default:
      return "OFFLINE";
  }
}

/**
 * Adaptador que expone CloudClient como IManagedConnection.
 * El cliente ya implementa activity timeout y forceReconnect;
 * este adapter solo mapea estados y engancha callbacks de resync.
 */
export class ManagedCloudConnection implements IManagedConnection {
  readonly name = "cloud";
  private unhealthyHandlers: Array<() => void> = [];
  private reconnectedHandlers: Array<() => void | Promise<void>> = [];

  constructor(private readonly client: CloudClient) {
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
    return mapCloudStateToHealth(this.client.connectionState);
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
