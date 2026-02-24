import type { IHomeAssistantClient } from "../../domain/ports/IHomeAssistantClient.js";
import type { ILogger } from "../../domain/ports/ILogger.js";
import type { Device } from "../../domain/entities/Device.js";
import type { CloudDevice } from "../../domain/entities/CloudDevice.js";
import { GetDevices } from "./GetDevices.js";
import { DeviceToCloudTransformer } from "./DeviceToCloudTransformer.js";
import { DUMIO_OFFICIAL_ENTITY_PREFIX } from "./SyncDevicesToCloud.js";

export interface GetCloudDevicesOutput {
  devices: CloudDevice[];
  count: number;
}

/**
 * Returns devices in the same format and filter as sent to cloud on devices:sync.
 * Only official Dumio devices (entity_id name part starts with dumio_plug).
 * Use for GET /api/devices to show exactly what would be synced.
 */
export class GetCloudDevices {
  private readonly getDevicesUseCase: GetDevices;

  constructor(
    private readonly haClient: IHomeAssistantClient,
    private readonly logger: ILogger
  ) {
    this.getDevicesUseCase = new GetDevices(haClient, logger);
  }

  async execute(): Promise<GetCloudDevicesOutput> {
    const devicesResult = await this.getDevicesUseCase.execute({
      includeFullDetails: true,
    });

    const allDevices = devicesResult.devices as Device[];

    const officialDevices = allDevices.filter((d) => {
      const [, name] = d.entityId.split(".");
      return (
        typeof name === "string" &&
        name.startsWith(DUMIO_OFFICIAL_ENTITY_PREFIX)
      );
    });

    const devices = DeviceToCloudTransformer.transform(officialDevices);

    this.logger.debug("GetCloudDevices", {
      total: allDevices.length,
      official: devices.length,
    });

    return { devices, count: devices.length };
  }
}
