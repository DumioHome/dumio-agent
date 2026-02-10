import type { IHomeAssistantClient } from "../../domain/ports/IHomeAssistantClient.js";
import type { ILogger } from "../../domain/ports/ILogger.js";
import type { DeviceUpdate } from "../../domain/ports/ICloudClient.js";

/**
 * Input for UpdateDeviceFromCloud use case
 */
export interface UpdateDeviceFromCloudInput {
  /** Device update data from cloud */
  deviceUpdate: DeviceUpdate;
}

/**
 * Output for UpdateDeviceFromCloud use case
 */
export interface UpdateDeviceFromCloudOutput {
  success: boolean;
  message: string;
  error?: string;
}

/**
 * Use case for updating device metadata in Home Assistant
 * when device information changes in Dumio Cloud
 *
 * This handles updates like:
 * - Device registry updates (model, manufacturer)
 * - Other metadata updates
 * 
 * Note: For updating entity names, use the entity:name:update event instead
 */
export class UpdateDeviceFromCloud {
  constructor(
    private readonly haClient: IHomeAssistantClient,
    private readonly logger: ILogger
  ) {}

  async execute(
    input: UpdateDeviceFromCloudInput
  ): Promise<UpdateDeviceFromCloudOutput> {
    const { deviceUpdate } = input;

    this.logger.info("Executing UpdateDeviceFromCloud use case", {
      deviceId: deviceUpdate.id,
      haDeviceId: deviceUpdate.deviceId,
      entityIds: deviceUpdate.entityIds,
      deviceCategoryId: deviceUpdate.deviceCategoryId,
      fullPayload: JSON.stringify(deviceUpdate),
    });

    try {
      // Validate required fields
      if (!deviceUpdate.id) {
        return {
          success: false,
          message: "Device ID is required",
          error: "Missing device id",
        };
      }

      // Normalize entityIds - handle both singular entityId and plural entityIds
      let entityIds: string[] = [];
      if (deviceUpdate.entityIds && deviceUpdate.entityIds.length > 0) {
        entityIds = deviceUpdate.entityIds;
      } else if ((deviceUpdate as unknown as { entityId?: string }).entityId) {
        // Handle singular entityId if provided
        entityIds = [(deviceUpdate as unknown as { entityId: string }).entityId];
        this.logger.debug("Normalized singular entityId to array", {
          entityId: entityIds[0],
        });
      }

      // If no deviceId or entityIds, we can't update anything
      if (!deviceUpdate.deviceId && entityIds.length === 0) {
        this.logger.warn("Cannot update device: no deviceId or entityIds provided", {
          deviceId: deviceUpdate.id,
          receivedEntityIds: deviceUpdate.entityIds,
        });
        return {
          success: false,
          message: "Cannot update device: no deviceId or entityIds provided",
          error: "Missing deviceId or entityIds",
        };
      }

      let deviceRegistryUpdated = false;

      // Update device registry if deviceId is provided
      if (deviceUpdate.deviceId) {
        try {
          const deviceRegistryUpdate: Record<string, unknown> = {};
          
          if (deviceUpdate.model) {
            deviceRegistryUpdate.model = deviceUpdate.model;
          }
          if (deviceUpdate.manufacturer) {
            deviceRegistryUpdate.manufacturer = deviceUpdate.manufacturer;
          }

          if (Object.keys(deviceRegistryUpdate).length > 0) {
            await this.updateDeviceRegistry(deviceUpdate.deviceId, deviceRegistryUpdate);
            deviceRegistryUpdated = true;
            this.logger.info("Updated device registry", {
              deviceId: deviceUpdate.deviceId,
              updates: deviceRegistryUpdate,
            });
          }
        } catch (error) {
          this.logger.error("Failed to update device registry", {
            deviceId: deviceUpdate.deviceId,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          // Don't fail the whole operation if device registry update fails
        }
      }

      if (!deviceRegistryUpdated) {
        return {
          success: false,
          message: "No updates were applied",
          error: "No valid update targets found",
        };
      }

      return {
        success: true,
        message: `Device updated successfully`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("UpdateDeviceFromCloud failed", {
        error: errorMessage,
        deviceId: deviceUpdate.id,
      });
      return {
        success: false,
        message: `Failed to update device: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Update device registry in Home Assistant
   */
  private async updateDeviceRegistry(
    deviceId: string,
    updates: Record<string, unknown>
  ): Promise<void> {
    if (Object.keys(updates).length === 0) {
      return;
    }

    const result = await this.haClient.sendCommand({
      type: "config/device_registry/update",
      device_id: deviceId,
      ...updates,
    } as Parameters<typeof this.haClient.sendCommand>[0]);

    if (!result.success) {
      throw new Error(
        result.error?.message ?? "Failed to update device registry"
      );
    }
  }
}
