import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDumioDeviceId } from "./deviceId.js";
import * as fs from "fs";

// Mock fs module
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

describe("getDumioDeviceId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when configuredDeviceId is provided", () => {
    it("should use configured device ID with dumio- prefix", () => {
      const result = getDumioDeviceId(false, "dumio-my-custom-id");

      expect(result).toBe("dumio-my-custom-id");
      // Should not try to read from file
      expect(fs.existsSync).not.toHaveBeenCalled();
    });

    it("should add dumio- prefix if not present", () => {
      const result = getDumioDeviceId(false, "my-custom-id");

      expect(result).toBe("dumio-my-custom-id");
    });

    it("should trim whitespace from configured ID", () => {
      const result = getDumioDeviceId(false, "  dumio-my-id  ");

      expect(result).toBe("dumio-my-id");
    });

    it("should ignore empty configured ID and fallback to file/generate", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = getDumioDeviceId(false, "");

      expect(fs.existsSync).toHaveBeenCalled();
      expect(result).toMatch(/^dumio-[a-f0-9]{16}$/);
    });

    it("should ignore whitespace-only configured ID", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = getDumioDeviceId(false, "   ");

      expect(fs.existsSync).toHaveBeenCalled();
      expect(result).toMatch(/^dumio-[a-f0-9]{16}$/);
    });

    it("should use configured ID even in addon mode", () => {
      const result = getDumioDeviceId(true, "dumio-addon-device");

      expect(result).toBe("dumio-addon-device");
      expect(fs.existsSync).not.toHaveBeenCalled();
    });
  });

  describe("when no configuredDeviceId is provided", () => {
    it("should read existing device ID from file in standalone mode", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("dumio-existing-id");

      const result = getDumioDeviceId(false);

      expect(result).toBe("dumio-existing-id");
      expect(fs.existsSync).toHaveBeenCalledWith(".dumio-device-id");
      expect(fs.readFileSync).toHaveBeenCalledWith(".dumio-device-id", "utf-8");
    });

    it("should read existing device ID from file in addon mode", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("dumio-addon-existing");

      const result = getDumioDeviceId(true);

      expect(result).toBe("dumio-addon-existing");
      expect(fs.existsSync).toHaveBeenCalledWith("/data/dumio-device-id");
      expect(fs.readFileSync).toHaveBeenCalledWith(
        "/data/dumio-device-id",
        "utf-8"
      );
    });

    it("should generate new device ID when file does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = getDumioDeviceId(false);

      expect(result).toMatch(/^dumio-[a-f0-9]{16}$/);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it("should generate new device ID when file content is invalid", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("invalid-id-without-prefix");

      const result = getDumioDeviceId(false);

      expect(result).toMatch(/^dumio-[a-f0-9]{16}$/);
    });

    it("should generate new device ID when file is empty", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("");

      const result = getDumioDeviceId(false);

      expect(result).toMatch(/^dumio-[a-f0-9]{16}$/);
    });

    it("should still return ID when file write fails", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const result = getDumioDeviceId(false);

      expect(result).toMatch(/^dumio-[a-f0-9]{16}$/);
    });

    it("should still return ID when file read throws error", () => {
      vi.mocked(fs.existsSync).mockImplementation(() => {
        throw new Error("Access denied");
      });

      const result = getDumioDeviceId(false);

      expect(result).toMatch(/^dumio-[a-f0-9]{16}$/);
    });
  });

  describe("device ID format", () => {
    it("should generate consistent format: dumio-{16 hex chars}", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Generate multiple IDs to verify format consistency
      const ids = Array.from({ length: 10 }, () => getDumioDeviceId(false));

      ids.forEach((id) => {
        expect(id).toMatch(/^dumio-[a-f0-9]{16}$/);
      });
    });

    it("should generate unique IDs", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const ids = new Set(
        Array.from({ length: 100 }, () => getDumioDeviceId(false))
      );

      // All IDs should be unique
      expect(ids.size).toBe(100);
    });
  });

  describe("priority order", () => {
    it("should prioritize configured ID over persisted file", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("dumio-from-file");

      const result = getDumioDeviceId(false, "dumio-from-config");

      expect(result).toBe("dumio-from-config");
      // Should not even check the file
      expect(fs.existsSync).not.toHaveBeenCalled();
    });
  });
});
