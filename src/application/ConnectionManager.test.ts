import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConnectionManager } from "./ConnectionManager.js";
import type { IManagedConnection, ConnectionHealthState } from "../domain/ports/IManagedConnection.js";
import type { ILogger } from "../domain/ports/ILogger.js";

function createMockConnection(
  name: string,
  initialState: ConnectionHealthState = "OFFLINE"
): IManagedConnection & {
  setState: (s: ConnectionHealthState) => void;
  triggerUnhealthy: () => void;
  triggerReconnected: () => void;
  startCalls: number;
  stopCalls: number;
  forceReconnectCalls: number;
} {
  let state = initialState;
  const unhealthyHandlers: Array<() => void> = [];
  const reconnectedHandlers: Array<() => void | Promise<void>> = [];
  const startFn = vi.fn().mockImplementation(async () => {
    state = "CONNECTED";
  });
  const stopFn = vi.fn().mockImplementation(async () => {
    state = "OFFLINE";
  });
  const forceReconnectFn = vi.fn().mockResolvedValue(undefined);

  return {
    name,
    getHealthState: () => state,
    start: startFn,
    stop: stopFn,
    forceReconnect: forceReconnectFn,
    onUnhealthy: (h: () => void) => unhealthyHandlers.push(h),
    onReconnected: (h: () => void | Promise<void>) => reconnectedHandlers.push(h),
    setState: (s: ConnectionHealthState) => {
      state = s;
    },
    triggerUnhealthy: () => unhealthyHandlers.forEach((h) => h()),
    triggerReconnected: () => {
      reconnectedHandlers.forEach((h) => {
        try {
          const p = h();
          if (p && typeof p.then === "function") p.catch(() => {});
        } catch {
          // ignore
        }
      });
    },
    get startCalls() {
      return startFn.mock.calls.length;
    },
    get stopCalls() {
      return stopFn.mock.calls.length;
    },
    get forceReconnectCalls() {
      return forceReconnectFn.mock.calls.length;
    },
  };
}

describe("ConnectionManager", () => {
  let logger: ILogger;

  beforeEach(() => {
    logger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
  });

  it("should register connection and report state", () => {
    const manager = new ConnectionManager(logger);
    const conn = createMockConnection("ha", "CONNECTED");
    manager.register("homeassistant", conn);
    expect(manager.getConnectionState("homeassistant")).toBe("CONNECTED");
    expect(manager.getAllStates()).toEqual({ homeassistant: "CONNECTED" });
  });

  it("should start all registered connections", async () => {
    const manager = new ConnectionManager(logger);
    const conn1 = createMockConnection("c1", "OFFLINE");
    const conn2 = createMockConnection("c2", "OFFLINE");
    manager.register("first", conn1);
    manager.register("second", conn2);
    await manager.startAll();
    expect(conn1.startCalls).toBe(1);
    expect(conn2.startCalls).toBe(1);
  });

  it("should stop all connections on stopAll", async () => {
    const manager = new ConnectionManager(logger);
    const conn = createMockConnection("ha", "CONNECTED");
    manager.register("ha", conn);
    await manager.startAll();
    await manager.stopAll();
    expect(conn.stopCalls).toBe(1);
  });

  it("should call forceReconnect when connection reports unhealthy", async () => {
    const manager = new ConnectionManager(logger);
    const conn = createMockConnection("ha", "CONNECTED");
    manager.register("ha", conn);
    conn.triggerUnhealthy();
    expect(conn.forceReconnectCalls).toBe(1);
  });

  it("should run resync callback when connection reports reconnected", async () => {
    const manager = new ConnectionManager(logger);
    const conn = createMockConnection("ha", "CONNECTED");
    const resync = vi.fn().mockResolvedValue(undefined);
    manager.register("ha", conn, resync);
    conn.triggerReconnected();
    await new Promise((r) => setImmediate(r));
    expect(resync).toHaveBeenCalled();
  });

  it("should not throw when resync callback is omitted", async () => {
    const manager = new ConnectionManager(logger);
    const conn = createMockConnection("ha", "CONNECTED");
    manager.register("ha", conn);
    expect(() => conn.triggerReconnected()).not.toThrow();
  });
});
