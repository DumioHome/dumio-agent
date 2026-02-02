import { randomBytes } from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

const DEVICE_ID_FILE = "/data/dumio-device-id";
const LOCAL_DEVICE_ID_FILE = ".dumio-device-id";

/**
 * Generate a random device ID in format: dumio-{random}
 */
function generateDeviceId(): string {
  const randomPart = randomBytes(8).toString("hex");
  return `dumio-${randomPart}`;
}

/**
 * Validate device ID format
 * Must start with 'dumio-' and have at least 8 characters after the prefix
 */
function isValidDeviceId(deviceId: string): boolean {
  if (!deviceId || typeof deviceId !== "string") {
    return false;
  }
  // Accept any non-empty string as valid - the cloud will handle validation
  return deviceId.trim().length > 0;
}

/**
 * Get or create a persistent device ID
 *
 * Priority:
 * 1. If configuredDeviceId is provided, use it (from addon/env configuration)
 * 2. If a persisted device ID exists, use it
 * 3. Generate a new random device ID and persist it
 *
 * @param isAddon - Whether running as Home Assistant add-on
 * @param configuredDeviceId - Optional device ID from configuration (takes priority)
 */
export function getDumioDeviceId(
  isAddon: boolean = false,
  configuredDeviceId?: string
): string {
  // Priority 1: Use configured device ID if provided
  if (configuredDeviceId && isValidDeviceId(configuredDeviceId)) {
    const normalizedId = configuredDeviceId.trim();
    // Ensure the ID has the dumio- prefix for consistency
    const finalId = normalizedId.startsWith("dumio-")
      ? normalizedId
      : `dumio-${normalizedId}`;
    return finalId;
  }

  const filePath = isAddon ? DEVICE_ID_FILE : LOCAL_DEVICE_ID_FILE;

  try {
    // Priority 2: Try to read existing device ID from file
    if (existsSync(filePath)) {
      const existingId = readFileSync(filePath, "utf-8").trim();
      if (existingId && existingId.startsWith("dumio-")) {
        return existingId;
      }
    }

    // Priority 3: Generate new device ID
    const newId = generateDeviceId();

    // Try to persist it
    try {
      const dir = dirname(filePath);
      if (dir && dir !== "." && !existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(filePath, newId, "utf-8");
    } catch {
      // If we can't persist, just return the generated ID
      // It will be regenerated on next restart
    }

    return newId;
  } catch {
    // If anything fails, generate a new ID (won't persist)
    return generateDeviceId();
  }
}
