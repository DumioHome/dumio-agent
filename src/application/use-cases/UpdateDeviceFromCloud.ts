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
  updatedEntities?: string[];
  error?: string;
}

/**
 * Use case for updating device metadata in Home Assistant
 * when device information changes in Dumio Cloud
 *
 * This handles updates like:
 * - Friendly name changes (entity registry)
 * - Device name changes (device registry)
 * - Other metadata updates
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
      name: deviceUpdate.name,
      deviceCategoryId: deviceUpdate.deviceCategoryId,
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

      // If no deviceId or entityIds, we can't update anything
      if (!deviceUpdate.deviceId && (!deviceUpdate.entityIds || deviceUpdate.entityIds.length === 0)) {
        this.logger.warn("Cannot update device: no deviceId or entityIds provided", {
          deviceId: deviceUpdate.id,
        });
        return {
          success: false,
          message: "Cannot update device: no deviceId or entityIds provided",
          error: "Missing deviceId or entityIds",
        };
      }

      const updatedEntities: string[] = [];

      // Update entity registry if name is provided and we have entityIds
      if (deviceUpdate.name && deviceUpdate.entityIds && deviceUpdate.entityIds.length > 0) {
        for (const entityId of deviceUpdate.entityIds) {
          try {
            await this.updateEntityRegistry(entityId, {
              name: deviceUpdate.name,
            });
            updatedEntities.push(entityId);
            this.logger.info("Updated entity registry", {
              entityId,
              name: deviceUpdate.name,
            });
          } catch (error) {
            this.logger.error("Failed to update entity registry", {
              entityId,
              error: error instanceof Error ? error.message : "Unknown error",
            });
            // Continue with other entities even if one fails
          }
        }
      }

      let deviceRegistryUpdated = false;

      // Update device registry if deviceId is provided
      if (deviceUpdate.deviceId) {
        try {
          const deviceRegistryUpdate: Record<string, unknown> = {};
          
          if (deviceUpdate.name) {
            deviceRegistryUpdate.name_by_user = deviceUpdate.name;
          }
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

      if (updatedEntities.length === 0 && !deviceRegistryUpdated) {
        return {
          success: false,
          message: "No updates were applied",
          error: "No valid update targets found",
        };
      }

      return {
        success: true,
        message: `Device updated successfully. Updated ${updatedEntities.length} entities`,
        updatedEntities,
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
   * Update entity registry in Home Assistant
   */
  private async updateEntityRegistry(
    entityId: string,
    updates: { name?: string }
  ): Promise<void> {
    const updateData: Record<string, unknown> = {};
    
    if (updates.name !== undefined) {
      updateData.name = updates.name;
    }

    if (Object.keys(updateData).length === 0) {
      return;
    }

    const result = await this.haClient.sendCommand({
      type: "config/entity_registry/update",
      entity_id: entityId,
      ...updateData,
    });

    if (!result.success) {
      throw new Error(
        result.error?.message ?? "Failed to update entity registry"
      );
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
    });

    if (!result.success) {
      throw new Error(
        result.error?.message ?? "Failed to update device registry"
      );
    }
  }
}
