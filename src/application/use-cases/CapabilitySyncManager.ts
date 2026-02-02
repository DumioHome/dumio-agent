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
import { DeviceStateWatcher } from "./DeviceStateWatcher.js";
import { DeviceController } from "./DeviceController.js";
import { SyncDevicesToCloud } from "./SyncDevicesToCloud.js";

/**
 * Stored sync state for restoration after reconnection
 */
interface SyncState {
  homeId: string;
  /** Devices with Dumio UUIDs from sync response */
  syncedDevices: SyncedDeviceInfo[];
  /** Original HA devices for controller */
  haDevices: CloudDevice[];
  syncedAt: number;
}

/**
 * Configuration for CapabilitySyncManager
 */
export interface CapabilitySyncManagerConfig {
  /** Dumio device ID for fetching devices after reconnection */
  dumioDeviceId: string;
  /** Whether to auto-restore sync state after reconnection */
  autoRestoreOnReconnect?: boolean;
}

/**
 * Manager that handles bidirectional capability synchronization between HA and Cloud
 *
 * Responsibilities:
 * - Watches for HA state changes and sends updates to cloud (via DeviceStateWatcher)
 * - Receives capability updates from cloud and applies them to HA (via DeviceController)
 * - Handles reconnection: fetches devices from cloud and restores sync state
 * - Manages the lifecycle of sync state
 */
export class CapabilitySyncManager {
  private deviceStateWatcher: DeviceStateWatcher | null = null;
  private deviceController: DeviceController | null = null;
  private syncState: SyncState | null = null;
  private isInitialized = false;
  private capabilitiesUpdatedHandler:
    | ((data: CapabilitiesUpdatedPayload) => void)
    | null = null;
  private connectionStateHandler:
    | ((state: CloudConnectionState) => void)
    | null = null;

  constructor(
    private readonly haClient: IHomeAssistantClient,
    private readonly cloudClient: ICloudClient,
    private readonly logger: ILogger,
    private readonly config: CapabilitySyncManagerConfig
  ) {
    this.logger.info("CapabilitySyncManager created", {
      dumioDeviceId: config.dumioDeviceId,
      autoRestoreOnReconnect: config.autoRestoreOnReconnect ?? true,
    });
  }

  /**
   * Initialize the sync manager after a successful manual sync
   * This is called after /api/devices/sync completes successfully
   *
   * @param homeId - The home ID
   * @param syncedDevices - Devices from cloud response with Dumio UUIDs
   * @param haDevices - Original HA devices for controller mappings
   */
  initializeFromSync(
    homeId: string,
    syncedDevices: SyncedDeviceInfo[],
    haDevices: CloudDevice[]
  ): void {
    this.logger.info("Initializing CapabilitySyncManager from sync", {
      homeId,
      syncedDeviceCount: syncedDevices.length,
      haDeviceCount: haDevices.length,
    });

    // Store sync state for potential restoration
    this.syncState = {
      homeId,
      syncedDevices,
      haDevices,
      syncedAt: Date.now(),
    };

    // Initialize device state watcher (HA -> Cloud) with Dumio UUIDs
    this.deviceStateWatcher = new DeviceStateWatcher(
      this.haClient,
      this.cloudClient,
      this.logger
    );
    this.deviceStateWatcher.initializeFromSyncResponse(homeId, syncedDevices);
    this.deviceStateWatcher.startWatching();

    // Initialize device controller (Cloud -> HA) with HA device mappings
    this.deviceController = new DeviceController(this.haClient, this.logger);
    this.deviceController.initializeFromSync(haDevices);

    // Register cloud event handlers
    this.registerCloudEventHandlers();

    // Register connection state handler for auto-restore
    this.registerConnectionStateHandler();

    this.isInitialized = true;

    this.logger.info("CapabilitySyncManager initialized successfully", {
      homeId,
      watchingEntities: this.deviceStateWatcher.mappingCount,
      controllableDevices: this.deviceController.mappingCount,
    });
  }

  /**
   * Register handler for capabilities:updated events from cloud
   */
  private registerCloudEventHandlers(): void {
    // Handle capabilities:updated from cloud
    this.capabilitiesUpdatedHandler = async (
      data: CapabilitiesUpdatedPayload
    ) => {
      await this.handleCapabilitiesUpdated(data);
    };

    this.cloudClient.on(
      "capabilities:updated",
      this.capabilitiesUpdatedHandler
    );

    this.logger.debug("Registered capabilities:updated handler");
  }

  /**
   * Register handler for connection state changes
   * Used to auto-restore sync state after reconnection
   */
  private registerConnectionStateHandler(): void {
    if (!this.config.autoRestoreOnReconnect) {
      return;
    }

    this.connectionStateHandler = async (state: CloudConnectionState) => {
      if (state === "connected" && this.syncState) {
        this.logger.info(
          "Cloud reconnected, attempting to restore sync state",
          {
            homeId: this.syncState.homeId,
            lastSyncAt: new Date(this.syncState.syncedAt).toISOString(),
          }
        );

        await this.restoreSyncStateFromCloud();
      }
    };

    this.cloudClient.onConnectionStateChange(this.connectionStateHandler);

    this.logger.debug("Registered connection state handler for auto-restore");
  }

  /**
   * Handle capabilities:updated event from cloud
   * This is called when an external source (app, another agent) updates a capability
   */
  private async handleCapabilitiesUpdated(
    data: CapabilitiesUpdatedPayload
  ): Promise<void> {
    this.logger.info("Received capabilities:updated from cloud", {
      deviceId: data.deviceId,
      entityId: data.entityId,
      capabilityType: data.capabilityType,
      value: data.value,
      source: data.source,
    });

    // Skip if source is this agent (avoid feedback loops)
    if (data.source === "agent") {
      this.logger.debug("Skipping capabilities:updated from own agent");
      return;
    }

    if (!this.deviceController) {
      this.logger.warn(
        "Cannot apply capabilities update: device controller not initialized"
      );
      return;
    }

    // Apply the capability change to HA
    try {
      const result = await this.deviceController.execute({
        deviceId: data.deviceId,
        entityId: data.entityId,
        capabilityType: data.capabilityType,
        value: data.value,
      });

      this.logger.info("Applied capabilities:updated to HA", {
        deviceId: data.deviceId,
        success: result.success,
        message: result.message,
      });
    } catch (error) {
      this.logger.error("Failed to apply capabilities:updated to HA", {
        deviceId: data.deviceId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Restore sync state from cloud after reconnection
   * Fetches devices from cloud using dumioDeviceId and re-initializes if devices exist
   */
  async restoreSyncStateFromCloud(): Promise<boolean> {
    this.logger.info("Attempting to restore sync state from cloud", {
      dumioDeviceId: this.config.dumioDeviceId,
    });

    try {
      // Fetch devices from cloud
      const response = await this.cloudClient.emitWithCallback(
        "devices:fetch",
        { dumioDeviceId: this.config.dumioDeviceId },
        30000
      );

      if (!response.success) {
        this.logger.warn("Failed to fetch devices from cloud", {
          error: response.error,
        });
        return false;
      }

      // Check if there are devices to restore
      if (!response.devices || response.devices.length === 0) {
        this.logger.info(
          "No devices found in cloud for this agent, waiting for manual sync"
        );
        this.reset();
        return false;
      }

      const homeId = response.homeId;
      if (!homeId) {
        this.logger.warn("No homeId returned from cloud");
        return false;
      }

      this.logger.info("Devices found in cloud, performing full re-sync", {
        homeId,
        deviceCount: response.devices.length,
      });

      // Perform a full re-sync to get fresh device states from HA
      const syncUseCase = new SyncDevicesToCloud(
        this.haClient,
        this.cloudClient,
        this.logger
      );

      const syncResult = await syncUseCase.execute({ homeId });

      if (
        !syncResult.success ||
        !syncResult.haDevices ||
        !syncResult.syncedDevices_info
      ) {
        this.logger.error("Failed to re-sync devices to cloud", {
          error: syncResult.error,
        });
        return false;
      }

      // Re-initialize with the fresh sync data
      this.reinitializeFromSync(
        homeId,
        syncResult.syncedDevices_info,
        syncResult.haDevices
      );

      this.logger.info("Sync state restored successfully", {
        homeId,
        syncedDevices: syncResult.syncedDevices,
      });

      return true;
    } catch (error) {
      this.logger.error("Error restoring sync state from cloud", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return false;
    }
  }

  /**
   * Re-initialize the manager with new sync data (used during restore)
   */
  private reinitializeFromSync(
    homeId: string,
    syncedDevices: SyncedDeviceInfo[],
    haDevices: CloudDevice[]
  ): void {
    // Stop existing watchers
    if (this.deviceStateWatcher) {
      this.deviceStateWatcher.reset();
    }

    // Update sync state
    this.syncState = {
      homeId,
      syncedDevices,
      haDevices,
      syncedAt: Date.now(),
    };

    // Re-initialize device state watcher with Dumio UUIDs
    this.deviceStateWatcher = new DeviceStateWatcher(
      this.haClient,
      this.cloudClient,
      this.logger
    );
    this.deviceStateWatcher.initializeFromSyncResponse(homeId, syncedDevices);
    this.deviceStateWatcher.startWatching();

    // Re-initialize device controller with HA device mappings
    this.deviceController = new DeviceController(this.haClient, this.logger);
    this.deviceController.initializeFromSync(haDevices);

    this.logger.info("CapabilitySyncManager re-initialized", {
      homeId,
      watchingEntities: this.deviceStateWatcher.mappingCount,
      controllableDevices: this.deviceController.mappingCount,
    });
  }

  /**
   * Check if the manager is currently active
   */
  get active(): boolean {
    return this.isInitialized && (this.deviceStateWatcher?.active ?? false);
  }

  /**
   * Get current sync state info
   */
  get syncInfo(): {
    homeId: string | null;
    deviceCount: number;
    syncedAt: number | null;
  } {
    return {
      homeId: this.syncState?.homeId ?? null,
      deviceCount: this.syncState?.syncedDevices.length ?? 0,
      syncedAt: this.syncState?.syncedAt ?? null,
    };
  }

  /**
   * Get the device state watcher for external access
   */
  get stateWatcher(): DeviceStateWatcher | null {
    return this.deviceStateWatcher;
  }

  /**
   * Get the device controller for external access
   */
  get controller(): DeviceController | null {
    return this.deviceController;
  }

  /**
   * Reset the manager - stops all watchers and clears state
   */
  reset(): void {
    this.logger.info("Resetting CapabilitySyncManager");

    // Unregister event handlers
    if (this.capabilitiesUpdatedHandler) {
      this.cloudClient.off(
        "capabilities:updated",
        this.capabilitiesUpdatedHandler
      );
      this.capabilitiesUpdatedHandler = null;
    }

    // Stop device state watcher
    if (this.deviceStateWatcher) {
      this.deviceStateWatcher.reset();
      this.deviceStateWatcher = null;
    }

    // Clear device controller
    this.deviceController = null;

    // Clear sync state
    this.syncState = null;
    this.isInitialized = false;

    this.logger.info("CapabilitySyncManager reset complete");
  }

  /**
   * Get statistics about the sync manager
   */
  getStats(): {
    isActive: boolean;
    homeId: string | null;
    deviceCount: number;
    watcherStats: {
      eventsReceived: number;
      updatesSkipped: number;
      updatesSent: number;
      updatesFailed: number;
    } | null;
    controllerMappings: number;
  } {
    return {
      isActive: this.active,
      homeId: this.syncState?.homeId ?? null,
      deviceCount: this.syncState?.syncedDevices.length ?? 0,
      watcherStats: this.deviceStateWatcher?.getStats() ?? null,
      controllerMappings: this.deviceController?.mappingCount ?? 0,
    };
  }
}
