import type { IHomeAssistantClient } from "../../domain/ports/IHomeAssistantClient.js";
import type { ICloudClient } from "../../domain/ports/ICloudClient.js";
import type { ILogger } from "../../domain/ports/ILogger.js";
import type { EntityState } from "../../domain/entities/Entity.js";
import type { DeviceType } from "../../domain/entities/Device.js";
import type {
  CloudCapabilityType,
  SyncedDeviceInfo,
} from "../../domain/entities/CloudDevice.js";

/**
 * Entity to Device mapping stored in memory
 * Now includes the Dumio UUID for sending updates to cloud
 */
interface EntityDeviceMapping {
  /** UUID de Dumio - this is what we send to the cloud */
  dumioDeviceId: string;
  /** HA device ID - for reference */
  haDeviceId: string;
  /** Entity ID */
  entityId: string;
  /** Device type */
  deviceType: DeviceType;
  /** Capability type for this entity */
  capabilityType: CloudCapabilityType;
}

/**
 * Cached state for comparison - now stores direct values
 */
interface CachedState {
  value: boolean | number | string | null;
  timestamp: number;
}

/**
 * Service that watches for HA state changes and sends real-time updates to cloud
 * Must be initialized after a successful devices:sync with the sync response
 * Only sends updates when values actually change (optimized for performance)
 *
 * IMPORTANT: Uses the Dumio UUID (not HA deviceId) when sending capability:update
 */
export class DeviceStateWatcher {
  /** Map of entityId -> device mapping info */
  private entityMappings = new Map<string, EntityDeviceMapping>();

  /** Map of entityId -> last sent value (for change detection) */
  private lastSentValues = new Map<string, CachedState>();

  /** Whether the watcher is currently active */
  private isWatching = false;

  /** Current homeId for updates */
  private currentHomeId: string | null = null;

  /** State change handler reference for cleanup */
  private stateChangeHandler:
    | ((
        entityId: string,
        oldState: EntityState | null,
        newState: EntityState
      ) => void)
    | null = null;

  /** Stats for debugging */
  private stats = {
    eventsReceived: 0,
    updatesSkipped: 0,
    updatesSent: 0,
    updatesFailed: 0,
  };

  constructor(
    private readonly haClient: IHomeAssistantClient,
    private readonly cloudClient: ICloudClient,
    private readonly logger: ILogger
  ) {}

  /**
   * Initialize the watcher with device mappings from a sync response
   * Call this after a successful devices:sync with the response data
   *
   * @param homeId - The home ID
   * @param syncedDevices - The devices returned from cloud with their Dumio UUIDs
   */
  initializeFromSyncResponse(
    homeId: string,
    syncedDevices: SyncedDeviceInfo[]
  ): void {
    this.currentHomeId = homeId;
    this.entityMappings.clear();
    this.lastSentValues.clear();
    this.resetStats();

    // Build entity -> device mapping with Dumio UUIDs
    for (const device of syncedDevices) {
      for (const entityId of device.entityIds) {
        // Determine the primary capability type for this entity
        const capabilityType = this.determineCapabilityType(entityId, device);

        this.entityMappings.set(entityId, {
          dumioDeviceId: device.id, // UUID de Dumio
          haDeviceId: device.deviceId,
          entityId,
          deviceType: device.deviceType as DeviceType,
          capabilityType,
        });
      }
    }

    this.logger.info("DeviceStateWatcher initialized with Dumio UUIDs", {
      homeId,
      mappedEntities: this.entityMappings.size,
      physicalDevices: syncedDevices.length,
    });
  }

  /**
   * Reset statistics
   */
  private resetStats(): void {
    this.stats = {
      eventsReceived: 0,
      updatesSkipped: 0,
      updatesSent: 0,
      updatesFailed: 0,
    };
  }

  /**
   * Start watching for state changes
   */
  startWatching(): void {
    if (this.isWatching) {
      this.logger.debug("DeviceStateWatcher already watching");
      return;
    }

    if (this.entityMappings.size === 0) {
      this.logger.warn(
        "Cannot start watching: no entity mappings. Call initializeFromSyncResponse first."
      );
      return;
    }

    // Create the state change handler
    this.stateChangeHandler = (
      entityId: string,
      oldState: EntityState | null,
      newState: EntityState
    ) => {
      this.handleStateChange(entityId, oldState, newState);
    };

    // Subscribe to state changes
    this.haClient.onStateChange(this.stateChangeHandler);

    this.isWatching = true;
    this.logger.info("DeviceStateWatcher started", {
      watchingEntities: this.entityMappings.size,
    });
  }

  /**
   * Stop watching for state changes
   */
  stopWatching(): void {
    if (!this.isWatching) {
      return;
    }

    if (this.stateChangeHandler) {
      this.haClient.offStateChange(this.stateChangeHandler);
      this.stateChangeHandler = null;
    }

    this.isWatching = false;
    this.logger.info("DeviceStateWatcher stopped");
  }

  /**
   * Clear all mappings and stop watching
   */
  reset(): void {
    this.stopWatching();
    this.entityMappings.clear();
    this.lastSentValues.clear();
    this.currentHomeId = null;
    this.logger.info("DeviceStateWatcher reset", { stats: this.stats });
    this.resetStats();
  }

  /**
   * Get current stats
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  /**
   * Check if watcher is active
   */
  get active(): boolean {
    return this.isWatching;
  }

  /**
   * Get current mapping count
   */
  get mappingCount(): number {
    return this.entityMappings.size;
  }

  /**
   * Handle a state change event from HA
   * Only sends update if the value actually changed
   */
  private handleStateChange(
    entityId: string,
    _oldState: EntityState | null,
    newState: EntityState
  ): void {
    this.stats.eventsReceived++;

    // Check if this entity is one we're tracking
    const mapping = this.entityMappings.get(entityId);

    if (!mapping) {
      // Not a tracked entity, ignore
      return;
    }

    // Check if cloud client is connected
    if (this.cloudClient.connectionState !== "connected") {
      this.logger.debug("Skipping capability update: cloud not connected", {
        entityId,
      });
      this.stats.updatesSkipped++;
      return;
    }

    // Extract the new value based on capability type (direct value, not wrapped)
    const currentValue = this.extractDirectValue(
      mapping.capabilityType,
      newState
    );

    if (currentValue === null) {
      this.logger.debug("Could not extract capability value", {
        entityId,
        capabilityType: mapping.capabilityType,
      });
      this.stats.updatesSkipped++;
      return;
    }

    // Check if value has actually changed
    const lastSent = this.lastSentValues.get(entityId);
    if (lastSent && this.areValuesEqual(lastSent.value, currentValue)) {
      // Value hasn't changed, skip sending
      this.stats.updatesSkipped++;
      return;
    }

    // Value changed, send update to cloud with callback
    this.sendCapabilityUpdate(mapping, currentValue, entityId);
  }

  /**
   * Send capability update to cloud using the Dumio UUID
   */
  private async sendCapabilityUpdate(
    mapping: EntityDeviceMapping,
    currentValue: boolean | number | string,
    entityId: string
  ): Promise<void> {
    try {
      const response = await this.cloudClient.emitWithCallback(
        "capability:update",
        {
          deviceId: mapping.dumioDeviceId, // UUID de Dumio, NOT HA deviceId
          capabilityType: mapping.capabilityType,
          currentValue,
        },
        10000 // 10 second timeout
      );

      if (response.success) {
        // Cache the sent value
        this.lastSentValues.set(entityId, {
          value: currentValue,
          timestamp: Date.now(),
        });

        this.stats.updatesSent++;

        this.logger.debug("Capability update sent to cloud", {
          dumioDeviceId: mapping.dumioDeviceId,
          haDeviceId: mapping.haDeviceId,
          entityId,
          capabilityType: mapping.capabilityType,
          currentValue,
          stats: this.stats,
        });
      } else {
        this.stats.updatesFailed++;
        this.logger.warn("Capability update failed", {
          dumioDeviceId: mapping.dumioDeviceId,
          entityId,
          error: response.error,
        });
      }
    } catch (error) {
      this.stats.updatesFailed++;
      this.logger.error("Error sending capability update", {
        dumioDeviceId: mapping.dumioDeviceId,
        entityId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Compare two direct values for equality
   */
  private areValuesEqual(
    a: boolean | number | string | null,
    b: boolean | number | string | null
  ): boolean {
    if (a === null || b === null) {
      return a === b;
    }

    // For numbers, use a small tolerance for floating point comparison
    if (typeof a === "number" && typeof b === "number") {
      return Math.abs(a - b) < 0.01;
    }

    return a === b;
  }

  /**
   * Determine the capability type for an entity based on its domain and the device info
   */
  private determineCapabilityType(
    entityId: string,
    device: SyncedDeviceInfo
  ): CloudCapabilityType {
    const [domain] = entityId.split(".");

    // Map domain to capability type
    const domainMapping: Record<string, CloudCapabilityType> = {
      light: "switch",
      switch: "switch",
      fan: "switch",
      climate: "mode",
      cover: "position",
      lock: "lock",
      media_player: "switch",
      vacuum: "switch",
    };

    if (domainMapping[domain]) {
      return domainMapping[domain];
    }

    // For sensors, try to determine from the device capabilities
    if (domain === "sensor" || domain === "binary_sensor") {
      // Check if this entity has a specific capability in the device
      const specificCaps: CloudCapabilityType[] = [
        "temperature",
        "humidity",
        "power",
        "battery",
        "energy",
      ];

      for (const cap of device.capabilities) {
        if (specificCaps.includes(cap.capabilityType)) {
          // Check if the entity name suggests this capability
          const entityLower = entityId.toLowerCase();
          if (
            entityLower.includes("temp") &&
            cap.capabilityType === "temperature"
          ) {
            return "temperature";
          }
          if (
            entityLower.includes("humid") &&
            cap.capabilityType === "humidity"
          ) {
            return "humidity";
          }
          if (entityLower.includes("power") && cap.capabilityType === "power") {
            return "power";
          }
          if (
            entityLower.includes("battery") &&
            cap.capabilityType === "battery"
          ) {
            return "battery";
          }
          if (
            entityLower.includes("energy") &&
            cap.capabilityType === "energy"
          ) {
            return "energy";
          }
        }
      }

      // For binary sensors
      if (domain === "binary_sensor") {
        const entityLower = entityId.toLowerCase();
        if (entityLower.includes("motion")) return "motion";
        if (entityLower.includes("door")) return "door";
        if (entityLower.includes("window")) return "window";
      }

      return "sensor";
    }

    return "switch";
  }

  /**
   * Extract the direct capability value from HA state based on capability type
   * Returns a direct value (true, 75, "heat") NOT wrapped in an object
   */
  private extractDirectValue(
    capabilityType: CloudCapabilityType,
    state: EntityState
  ): boolean | number | string | null {
    const stateValue = state.state;
    const attrs = state.attributes;

    switch (capabilityType) {
      case "switch":
        return (
          stateValue === "on" ||
          stateValue === "playing" ||
          stateValue === "cleaning"
        );

      case "brightness":
        if (attrs.brightness !== undefined) {
          return Math.round(((attrs.brightness as number) / 255) * 100);
        }
        return null;

      case "color_temp":
        if (attrs.color_temp_kelvin !== undefined) {
          return attrs.color_temp_kelvin as number;
        }
        if (attrs.color_temp !== undefined) {
          return Math.round(1000000 / (attrs.color_temp as number));
        }
        return null;

      case "temperature":
        const temp =
          attrs.temperature ??
          attrs.current_temperature ??
          parseFloat(stateValue);
        if (!isNaN(temp as number)) {
          return temp as number;
        }
        return null;

      case "humidity":
        const humidity =
          attrs.humidity ?? attrs.current_humidity ?? parseFloat(stateValue);
        if (!isNaN(humidity as number)) {
          return humidity as number;
        }
        return null;

      case "battery":
        const battery =
          attrs.battery_level ?? attrs.battery ?? parseFloat(stateValue);
        if (!isNaN(battery as number)) {
          return battery as number;
        }
        return null;

      case "power":
        const power = attrs.power ?? parseFloat(stateValue);
        if (!isNaN(power as number)) {
          return power as number;
        }
        return null;

      case "energy":
        const energy = attrs.energy ?? parseFloat(stateValue);
        if (!isNaN(energy as number)) {
          return energy as number;
        }
        return null;

      case "position":
        const position = attrs.current_position ?? parseFloat(stateValue);
        if (!isNaN(position as number)) {
          return position as number;
        }
        return null;

      case "volume":
        if (attrs.volume_level !== undefined) {
          return Math.round((attrs.volume_level as number) * 100);
        }
        return null;

      case "mode":
        return (attrs.hvac_mode ?? stateValue) as string;

      case "preset":
        if (attrs.preset_mode !== undefined) {
          return attrs.preset_mode as string;
        }
        return null;

      case "motion":
      case "door":
      case "window":
        return stateValue === "on" || stateValue === "open";

      case "lock":
        return stateValue === "locked";

      case "sensor":
        // Generic sensor - try to parse as number
        const numValue = parseFloat(stateValue);
        if (!isNaN(numValue)) {
          return numValue;
        }
        return stateValue;

      case "color":
        // Color is special - we can't send RGB as a single value
        // For now, skip color updates or handle separately
        return null;

      default:
        return null;
    }
  }
}
