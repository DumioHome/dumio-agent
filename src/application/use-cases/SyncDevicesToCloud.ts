import type { IHomeAssistantClient } from "../../domain/ports/IHomeAssistantClient.js";
import type { ICloudClient } from "../../domain/ports/ICloudClient.js";
import type { ILogger } from "../../domain/ports/ILogger.js";
import type { Device } from "../../domain/entities/Device.js";
import type {
  CloudDevice,
  DevicesSyncCallbackResponse,
  SyncedDeviceInfo,
} from "../../domain/entities/CloudDevice.js";
import { GetDevices } from "./GetDevices.js";
import { DeviceToCloudTransformer } from "./DeviceToCloudTransformer.js";
import { isDumioOfficialEntity } from "../../domain/entities/DumioEntity.js";

export interface SyncDevicesToCloudInput {
  homeId: string;
}

export interface SyncDevicesToCloudOutput {
  success: boolean;
  syncedDevices: number;
  /** The HA devices that were sent (for controller mappings) */
  haDevices?: CloudDevice[];
  /** The synced devices from cloud response with Dumio UUIDs (for state watcher) */
  syncedDevices_info?: SyncedDeviceInfo[];
  response?: DevicesSyncCallbackResponse;
  error?: string;
}

/**
 * Use case for syncing devices from Home Assistant to the cloud
 * Transforms HA devices to the cloud format and emits the sync event
 */
export class SyncDevicesToCloud {
  private readonly getDevicesUseCase: GetDevices;

  constructor(
    private readonly haClient: IHomeAssistantClient,
    private readonly cloudClient: ICloudClient,
    private readonly logger: ILogger
  ) {
    this.getDevicesUseCase = new GetDevices(haClient, logger);
  }

  async execute(
    input: SyncDevicesToCloudInput
  ): Promise<SyncDevicesToCloudOutput> {
    this.logger.info("Executing SyncDevicesToCloud use case", {
      homeId: input.homeId,
    });

    try {
      // Get all devices with full details from HA
      const devicesResult = await this.getDevicesUseCase.execute({
        includeFullDetails: true,
      });

      const allDevices = devicesResult.devices as Device[];

      // Solo sincronizamos dispositivos oficiales Dumio:
      // la parte de nombre del entity_id (después del ".") debe empezar por dumio_plug
      const haDevices = allDevices.filter((d) =>
        isDumioOfficialEntity(d.entityId)
      );

      this.logger.debug("Fetched entities from Home Assistant", {
        entityCount: allDevices.length,
        officialDumioCount: haDevices.length,
      });

      const cloudDevices = DeviceToCloudTransformer.transform(haDevices);

      this.logger.debug("Transformed to physical devices", {
        physicalDeviceCount: cloudDevices.length,
        totalEntities: haDevices.length,
      });

      // Emit sync event to cloud with callback
      this.logger.debug("Sending devices:sync to cloud", {
        homeId: input.homeId,
        deviceCount: cloudDevices.length,
        devices: cloudDevices.map((d) => ({
          deviceId: d.deviceId,
          type: d.deviceType,
          entityCount: d.entityIds.length,
          capabilities: d.capabilities.length,
        })),
      });

      const response = await this.cloudClient.emitWithCallback(
        "devices:sync",
        {
          homeId: input.homeId,
          devices: cloudDevices,
        },
        30000 // 30 second timeout
      );

      this.logger.info("Devices synced to cloud", {
        homeId: input.homeId,
        syncedDevices: cloudDevices.length,
        success: response.success,
        cloudResponse: response,
      });

      return {
        success: response.success,
        syncedDevices: cloudDevices.length,
        haDevices: cloudDevices,
        syncedDevices_info: response.data?.devices,
        response,
        error: response.error,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Error syncing devices to cloud", {
        error: errorMessage,
      });

      return {
        success: false,
        syncedDevices: 0,
        error: errorMessage,
      };
    }
  }

}
