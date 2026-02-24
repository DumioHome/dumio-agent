import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CapabilitySyncManager } from "./CapabilitySyncManager.js";
import type { IHomeAssistantClient } from "../../domain/ports/IHomeAssistantClient.js";
import type {
  ICloudClient,
  CloudConnectionState,
} from "../../domain/ports/ICloudClient.js";
import type { ILogger } from "../../domain/ports/ILogger.js";
import type {
  CloudDevice,
  SyncedDeviceInfo,
  CapabilitiesUpdatedPayload,
} from "../../domain/entities/CloudDevice.js";

// Mock implementations
const createMockLogger = (): ILogger => ({
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn().mockReturnThis(),
});

const createMockHaClient = (): IHomeAssistantClient => ({
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  connectionState: "connected",
  sendMessage: vi
    .fn()
    .mockResolvedValue({ id: 1, type: "result", success: true }),
  subscribeToEvents: vi.fn().mockResolvedValue({ unsubscribe: vi.fn() }),
  onStateChange: vi.fn(),
  offStateChange: vi.fn(),
  onConnectionStateChange: vi.fn(),
});

const createMockCloudClient = (
  connectionState: CloudConnectionState = "connected"
): ICloudClient => ({
  connectionState,
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  sendHealth: vi.fn(),
  emit: vi.fn(),
  emitWithCallback: vi.fn().mockResolvedValue({ success: true }),
  on: vi.fn(),
  off: vi.fn(),
  onConnectionStateChange: vi.fn(),
});

// Mock HA devices (CloudDevice format - what we send to cloud)
const createMockHaDevices = (): CloudDevice[] => [
  {
    deviceId: "ha-device-1",
    entityIds: ["light.living_room"],
    deviceType: "light",
    name: "Living Room Light",
    model: "Smart Bulb",
    manufacturer: "Test",
    roomName: "Living Room",
    integration: "tuya",
    capabilities: [
      {
        capabilityType: "switch",
        valueType: "boolean",
        currentValue: { on: true },
        meta: null,
      },
      {
        capabilityType: "brightness",
        valueType: "number",
        currentValue: { value: 75 },
        meta: { min: 0, max: 100, unit: "%" },
      },
    ],
  },
  {
    deviceId: "ha-device-2",
    entityIds: ["sensor.temperature"],
    deviceType: "sensor",
    name: "Temperature Sensor",
    model: "Temp Sensor",
    manufacturer: "Test",
    roomName: "Bedroom",
    integration: "zha",
    capabilities: [
      {
        capabilityType: "temperature",
        valueType: "number",
        currentValue: { value: 22.5 },
        meta: { unit: "°C" },
      },
    ],
  },
];

// Mock synced devices (SyncedDeviceInfo format - what cloud returns with Dumio UUIDs)
const createMockSyncedDevices = (): SyncedDeviceInfo[] => [
  {
    id: "550e8400-e29b-41d4-a716-446655440001", // Dumio UUID
    deviceId: "ha-device-1", // HA device ID
    entityIds: ["light.living_room"],
    deviceType: "light",
    name: "Living Room Light",
    model: "Smart Bulb",
    manufacturer: "Test",
    capabilities: [
      {
        id: "cap-uuid-1",
        capabilityType: "switch",
        valueType: "boolean",
        currentValue: true,
        meta: null,
      },
      {
        id: "cap-uuid-2",
        capabilityType: "brightness",
        valueType: "number",
        currentValue: 75,
        meta: { min: 0, max: 100, unit: "%" },
      },
    ],
    isNew: true,
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440002", // Dumio UUID
    deviceId: "ha-device-2", // HA device ID
    entityIds: ["sensor.temperature"],
    deviceType: "sensor",
    name: "Temperature Sensor",
    model: "Temp Sensor",
    manufacturer: "Test",
    capabilities: [
      {
        id: "cap-uuid-3",
        capabilityType: "temperature",
        valueType: "number",
        currentValue: 22.5,
        meta: { unit: "°C" },
      },
    ],
    isNew: true,
  },
];

describe("CapabilitySyncManager", () => {
  let manager: CapabilitySyncManager;
  let mockHaClient: IHomeAssistantClient;
  let mockCloudClient: ICloudClient;
  let mockLogger: ILogger;
  let mockHaDevices: CloudDevice[];
  let mockSyncedDevices: SyncedDeviceInfo[];

  beforeEach(() => {
    mockHaClient = createMockHaClient();
    mockCloudClient = createMockCloudClient();
    mockLogger = createMockLogger();
    mockHaDevices = createMockHaDevices();
    mockSyncedDevices = createMockSyncedDevices();

    manager = new CapabilitySyncManager(
      mockHaClient,
      mockCloudClient,
      mockLogger,
      {
        dumioDeviceId: "test-dumio-device",
        autoRestoreOnReconnect: true,
      }
    );
  });

  afterEach(() => {
    manager.reset();
    vi.clearAllMocks();
  });

  describe("initialization", () => {
    it("should be created in inactive state", () => {
      expect(manager.active).toBe(false);
      expect(manager.syncInfo.homeId).toBeNull();
      expect(manager.syncInfo.deviceCount).toBe(0);
    });

    it("should initialize from sync with devices", () => {
      manager.initializeFromSync("home-123", mockSyncedDevices, mockHaDevices);

      expect(manager.active).toBe(true);
      expect(manager.syncInfo.homeId).toBe("home-123");
      expect(manager.syncInfo.deviceCount).toBe(2);
      expect(mockLogger.info).toHaveBeenCalledWith(
        "CapabilitySyncManager initialized successfully",
        expect.any(Object)
      );
    });

    it("should register cloud event handlers on initialization", () => {
      manager.initializeFromSync("home-123", mockSyncedDevices, mockHaDevices);

      expect(mockCloudClient.on).toHaveBeenCalledWith(
        "capabilities:updated",
        expect.any(Function)
      );
    });

    it("should register connection state handler for auto-restore", () => {
      manager.initializeFromSync("home-123", mockSyncedDevices, mockHaDevices);

      expect(mockCloudClient.onConnectionStateChange).toHaveBeenCalledWith(
        expect.any(Function)
      );
    });
  });

  describe("capabilities:updated handling", () => {
    it("should handle capabilities:updated event from cloud", async () => {
      manager.initializeFromSync("home-123", mockSyncedDevices, mockHaDevices);

      // Get the registered handler
      const onCall = vi.mocked(mockCloudClient.on);
      const capabilitiesHandler = onCall.mock.calls.find(
        (call) => call[0] === "capabilities:updated"
      )?.[1] as (data: CapabilitiesUpdatedPayload) => void;

      expect(capabilitiesHandler).toBeDefined();

      // Simulate receiving a capabilities:updated event
      await capabilitiesHandler({
        deviceId: "550e8400-e29b-41d4-a716-446655440001",
        entityId: "light.living_room",
        capabilityType: "switch",
        value: { on: false },
        source: "app",
        timestamp: new Date().toISOString(),
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Received capabilities:updated from cloud",
        expect.any(Object)
      );
    });

    it("should skip capabilities:updated from own agent to avoid feedback loops", async () => {
      manager.initializeFromSync("home-123", mockSyncedDevices, mockHaDevices);

      const onCall = vi.mocked(mockCloudClient.on);
      const capabilitiesHandler = onCall.mock.calls.find(
        (call) => call[0] === "capabilities:updated"
      )?.[1] as (data: CapabilitiesUpdatedPayload) => void;

      await capabilitiesHandler({
        deviceId: "550e8400-e29b-41d4-a716-446655440001",
        entityId: "light.living_room",
        capabilityType: "switch",
        value: { on: false },
        source: "agent", // From own agent
        timestamp: new Date().toISOString(),
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Skipping capabilities:updated from own agent"
      );
    });
  });

  describe("reset", () => {
    it("should reset all state and handlers", () => {
      manager.initializeFromSync("home-123", mockSyncedDevices, mockHaDevices);

      expect(manager.active).toBe(true);

      manager.reset();

      expect(manager.active).toBe(false);
      expect(manager.syncInfo.homeId).toBeNull();
      expect(manager.syncInfo.deviceCount).toBe(0);
      expect(mockCloudClient.off).toHaveBeenCalledWith(
        "capabilities:updated",
        expect.any(Function)
      );
    });
  });

  describe("getStats", () => {
    it("should return correct stats when initialized", () => {
      manager.initializeFromSync("home-123", mockSyncedDevices, mockHaDevices);

      const stats = manager.getStats();

      expect(stats.isActive).toBe(true);
      expect(stats.homeId).toBe("home-123");
      expect(stats.deviceCount).toBe(2);
      expect(stats.controllerMappings).toBeGreaterThan(0);
    });

    it("should return default stats when not initialized", () => {
      const stats = manager.getStats();

      expect(stats.isActive).toBe(false);
      expect(stats.homeId).toBeNull();
      expect(stats.deviceCount).toBe(0);
      expect(stats.controllerMappings).toBe(0);
    });
  });

  describe("restoreSyncStateFromCloud", () => {
    it("should fetch devices from cloud and re-sync", async () => {
      // Setup mock to return devices from cloud
      vi.mocked(mockCloudClient.emitWithCallback).mockResolvedValue({
        success: true,
        homeId: "home-123",
        devices: [
          {
            deviceId: "ha-device-1",
            entityIds: ["light.test"],
            deviceType: "light",
            name: "Test",
          },
        ],
      });

      // First initialize
      manager.initializeFromSync("home-123", mockSyncedDevices, mockHaDevices);
      manager.reset();

      // Re-create manager to simulate reconnection
      manager = new CapabilitySyncManager(
        mockHaClient,
        mockCloudClient,
        mockLogger,
        {
          dumioDeviceId: "test-dumio-device",
          autoRestoreOnReconnect: true,
        }
      );

      // This would normally be called by the connection state handler
      await manager.restoreSyncStateFromCloud();

      // Note: The full restore includes a SyncDevicesToCloud call which we're not fully mocking
      // So we just check that it attempted to fetch devices
      expect(mockCloudClient.emitWithCallback).toHaveBeenCalledWith(
        "devices:fetch",
        { dumioDeviceId: "test-dumio-device" },
        30000
      );
    });

    it("should return false when no devices found in cloud", async () => {
      vi.mocked(mockCloudClient.emitWithCallback).mockResolvedValue({
        success: true,
        homeId: "home-123",
        devices: [], // No devices
      });

      const result = await manager.restoreSyncStateFromCloud();

      expect(result).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith(
        "No devices found in cloud for this agent, waiting for manual sync"
      );
    });

    it("should return false when cloud fetch fails", async () => {
      vi.mocked(mockCloudClient.emitWithCallback).mockResolvedValue({
        success: false,
        error: "Cloud error",
      });

      const result = await manager.restoreSyncStateFromCloud();

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Failed to fetch devices from cloud",
        expect.any(Object)
      );
    });
  });

  describe("auto-restore on reconnection", () => {
    it("should not register connection handler when autoRestoreOnReconnect is false", () => {
      const managerNoAutoRestore = new CapabilitySyncManager(
        mockHaClient,
        mockCloudClient,
        mockLogger,
        {
          dumioDeviceId: "test-dumio-device",
          autoRestoreOnReconnect: false,
        }
      );

      managerNoAutoRestore.initializeFromSync(
        "home-123",
        mockSyncedDevices,
        mockHaDevices
      );

      // Should still register capabilities:updated handler
      expect(mockCloudClient.on).toHaveBeenCalledWith(
        "capabilities:updated",
        expect.any(Function)
      );

      // But onConnectionStateChange should only be called once (from capabilities handler registration)
      // not for auto-restore
      const connectionStateCalls = vi.mocked(
        mockCloudClient.onConnectionStateChange
      ).mock.calls;
      expect(connectionStateCalls.length).toBe(0);
    });
  });
});
