import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const DEVICE_ID_FILE = '/data/dumio-device-id';
const LOCAL_DEVICE_ID_FILE = '.dumio-device-id';

/**
 * Generate a random device ID in format: dumio-{random}
 */
function generateDeviceId(): string {
  const randomPart = randomBytes(8).toString('hex');
  return `dumio-${randomPart}`;
}

/**
 * Get or create a persistent device ID
 * - In add-on mode: stored in /data/dumio-device-id
 * - In standalone mode: stored in .dumio-device-id
 */
export function getDumioDeviceId(isAddon: boolean = false): string {
  const filePath = isAddon ? DEVICE_ID_FILE : LOCAL_DEVICE_ID_FILE;

  try {
    // Try to read existing device ID
    if (existsSync(filePath)) {
      const existingId = readFileSync(filePath, 'utf-8').trim();
      if (existingId && existingId.startsWith('dumio-')) {
        return existingId;
      }
    }

    // Generate new device ID
    const newId = generateDeviceId();

    // Try to persist it
    try {
      const dir = dirname(filePath);
      if (dir && dir !== '.' && !existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(filePath, newId, 'utf-8');
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
