/**
 * Get the configured Dumio Device ID
 *
 * This function only returns a device ID if it's explicitly configured.
 * It does NOT auto-generate IDs - health reporting is only enabled when
 * a device ID is configured from the addon interface or environment variable.
 *
 * @param configuredDeviceId - Device ID from configuration (addon options or env var)
 * @returns The configured device ID with dumio- prefix, or undefined if not configured
 */
export function getDumioDeviceId(
  configuredDeviceId?: string
): string | undefined {
  // Only return a device ID if explicitly configured
  if (!configuredDeviceId || typeof configuredDeviceId !== "string") {
    return undefined;
  }

  const trimmedId = configuredDeviceId.trim();
  if (trimmedId.length === 0) {
    return undefined;
  }

  // Ensure the ID has the dumio- prefix for consistency
  return trimmedId.startsWith("dumio-") ? trimmedId : `dumio-${trimmedId}`;
}
