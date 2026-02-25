import { describe, it, expect, vi, beforeEach } from "vitest";
import { GetCloudDevices } from "./GetCloudDevices.js";
import type { IHomeAssistantClient } from "../../domain/ports/IHomeAssistantClient.js";
import type { ILogger } from "../../domain/ports/ILogger.js";
import type { EntityState } from "../../domain/entities/Entity.js";

describe("GetCloudDevices", () => {
  let mockHaClient: IHomeAssistantClient;
  let mockLogger: ILogger;
  let useCase: GetCloudDevices;
  let mockStates: EntityState[];

  beforeEach(() => {
    mockStates = [
      {
        entity_id: "switch.dumio_plug_kitchen",
        state: "off",
        attributes: { friendly_name: "Kitchen Plug" },
        last_changed: "2024-01-01T09:00:00Z",
        last_updated: "2024-01-01T09:00:00Z",
        context: { id: "1", parent_id: null, user_id: null },
      },
      {
        entity_id: "light.other_light",
        state: "on",
        attributes: { friendly_name: "Other Light" },
        last_changed: "2024-01-01T10:00:00Z",
        last_updated: "2024-01-01T10:00:00Z",
        context: { id: "2", parent_id: null, user_id: null },
      },
    ];

    mockHaClient = {
      connectionState: "connected",
      haVersion: "2024.1.0",
      connect: vi.fn(),
      disconnect: vi.fn(),
      sendCommand: vi.fn().mockImplementation(({ type }) => {
        if (type === "config/device_registry/list") {
          return Promise.resolve({
            result: [
              {
                id: "dev1",
                name: "Kitchen Plug",
                manufacturer: "Dumio",
                model: "Plug",
                area_id: "kitchen",
                identifiers: [["dumio", "abc"]],
              },
              {
                id: "dev2",
                name: "Other Light",
                manufacturer: "X",
                model: "Y",
                area_id: "living_room",
                identifiers: [["zha", "def"]],
              },
            ],
          });
        }
        if (type === "config/area_registry/list") {
          return Promise.resolve({
            result: [{ area_id: "kitchen", name: "Cocina" }],
          });
        }
        if (type === "config/entity_registry/list") {
          return Promise.resolve({
            result: [
              { entity_id: "switch.dumio_plug_kitchen", device_id: "dev1", area_id: "kitchen" },
              { entity_id: "light.other_light", device_id: "dev2", area_id: "living_room" },
            ],
          });
        }
        return Promise.resolve({ result: [] });
      }),
      subscribeEvents: vi.fn(),
      unsubscribeEvents: vi.fn(),
      getStates: vi.fn().mockResolvedValue(mockStates),
      getConfig: vi.fn(),
      getServices: vi.fn(),
      callService: vi.fn(),
      ping: vi.fn(),
      onMessage: vi.fn(),
      onEvent: vi.fn(),
      onStateChange: vi.fn(),
      onConnectionStateChange: vi.fn(),
      offMessage: vi.fn(),
      offEvent: vi.fn(),
      offStateChange: vi.fn(),
      offConnectionStateChange: vi.fn(),
    };

    mockLogger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };

    useCase = new GetCloudDevices(mockHaClient, mockLogger);
  });

  it("returns only official Dumio devices (entity_id name starts with dumio_plug)", async () => {
    const result = await useCase.execute();

    expect(result.count).toBe(1);
    expect(result.devices).toHaveLength(1);
    expect(result.devices[0].entityIds).toEqual(["switch.dumio_plug_kitchen"]);
    expect(result.devices[0].deviceId).toBe("dev1");
    expect(result.devices[0].deviceType).toBe("dumio_switch");
  });

  it("returns CloudDevice shape (deviceId, entityIds, deviceType, capabilities, etc.)", async () => {
    const result = await useCase.execute();

    const d = result.devices[0];
    expect(d).toHaveProperty("deviceId");
    expect(d).toHaveProperty("entityIds");
    expect(d).toHaveProperty("deviceType");
    expect(d).toHaveProperty("model");
    expect(d).toHaveProperty("manufacturer");
    expect(d).toHaveProperty("roomName");
    expect(d).toHaveProperty("integration");
    expect(d).toHaveProperty("capabilities");
    expect(Array.isArray(d.capabilities)).toBe(true);
  });
});
