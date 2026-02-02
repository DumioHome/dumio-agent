import { describe, it, expect } from "vitest";
import { getDumioDeviceId } from "./deviceId.js";

describe("getDumioDeviceId", () => {
  describe("when configuredDeviceId is provided", () => {
    it("should return the configured device ID with dumio- prefix", () => {
      const result = getDumioDeviceId("dumio-my-custom-id");

      expect(result).toBe("dumio-my-custom-id");
    });

    it("should add dumio- prefix if not present", () => {
      const result = getDumioDeviceId("my-custom-id");

      expect(result).toBe("dumio-my-custom-id");
    });

    it("should trim whitespace from configured ID", () => {
      const result = getDumioDeviceId("  dumio-my-id  ");

      expect(result).toBe("dumio-my-id");
    });

    it("should handle ID without prefix and with whitespace", () => {
      const result = getDumioDeviceId("  my-device  ");

      expect(result).toBe("dumio-my-device");
    });
  });

  describe("when configuredDeviceId is NOT provided", () => {
    it("should return undefined when no ID is provided", () => {
      const result = getDumioDeviceId();

      expect(result).toBeUndefined();
    });

    it("should return undefined for undefined input", () => {
      const result = getDumioDeviceId(undefined);

      expect(result).toBeUndefined();
    });

    it("should return undefined for empty string", () => {
      const result = getDumioDeviceId("");

      expect(result).toBeUndefined();
    });

    it("should return undefined for whitespace-only string", () => {
      const result = getDumioDeviceId("   ");

      expect(result).toBeUndefined();
    });

    it("should return undefined for null-like values", () => {
      // @ts-expect-error - testing runtime behavior with invalid input
      const result = getDumioDeviceId(null);

      expect(result).toBeUndefined();
    });
  });

  describe("device ID format", () => {
    it("should always return ID with dumio- prefix when configured", () => {
      expect(getDumioDeviceId("test")).toBe("dumio-test");
      expect(getDumioDeviceId("dumio-test")).toBe("dumio-test");
      expect(getDumioDeviceId("my-home-agent")).toBe("dumio-my-home-agent");
    });

    it("should preserve the rest of the ID after prefix", () => {
      expect(getDumioDeviceId("dumio-abc123")).toBe("dumio-abc123");
      expect(getDumioDeviceId("dumio-casa-principal")).toBe(
        "dumio-casa-principal"
      );
    });
  });

  describe("behavior - no auto-generation", () => {
    it("should NOT auto-generate an ID - returns undefined instead", () => {
      // This is the key behavior change: no auto-generation
      const result = getDumioDeviceId();

      expect(result).toBeUndefined();
      // Health reporting should be disabled when this returns undefined
    });
  });
});
