import type {
  Device,
  DeviceType,
} from "../../domain/entities/Device.js";
import type {
  CloudDevice,
  CloudCapability,
  CloudCapabilityType,
  CloudDeviceType,
} from "../../domain/entities/CloudDevice.js";

/**
 * Transforms HA Device[] to CloudDevice[] (same format sent to cloud on devices:sync).
 * Used by SyncDevicesToCloud and GetCloudDevices so the API and sync stay in sync.
 */
export class DeviceToCloudTransformer {
  /**
   * Transform HA devices to CloudDevice format.
   * Each entity becomes a separate CloudDevice, but the deviceType is
   * classified using ALL entities of the same physical device (same deviceId).
   */
  static transform(haDevices: Device[]): CloudDevice[] {
    // Group entities by physical deviceId
    const byDeviceId = new Map<string, Device[]>();
    for (const device of haDevices) {
      const list = byDeviceId.get(device.id) ?? [];
      list.push(device);
      byDeviceId.set(device.id, list);
    }

    return haDevices.map((device) => {
      const group = byDeviceId.get(device.id) ?? [device];
      const deviceType = this.classifyDevice(group);
      return this.createCloudDeviceFromEntity(device, deviceType);
    });
  }

  private static createCloudDeviceFromEntity(
    device: Device,
    deviceType: CloudDeviceType
  ): CloudDevice {
    const capabilities = this.extractCapabilities(device);
    return {
      deviceId: device.id,
      entityIds: [device.entityId],
      deviceType,
      model: device.model,
      manufacturer: device.manufacturer,
      roomName: device.roomName,
      integration: device.integration,
      capabilities,
    };
  }

  /**
   * Classify a physical device based on all its entities (Device[])
   * and return a Dumio-level CloudDeviceType.
   */
  private static classifyDevice(devices: Device[]): CloudDeviceType {
    const types = devices.map((d) => d.type);

    const hasClimate =
      types.includes("climate") || types.includes("thermostat");
    const hasLight = types.includes("light");
    const hasSwitch = types.includes("switch");
    const hasPowerSensor = types.includes("power");
    const hasTemp = types.includes("temperature");
    const hasHumidity = types.includes("humidity");

    // Sensor-like device types (environmental sensors, binary sensors, etc.)
    const sensorLikeTypes: DeviceType[] = [
      "sensor",
      "binary_sensor",
      "temperature",
      "humidity",
      "power",
      "battery",
      "door",
      "window",
      "motion",
    ];
    const hasSensorLike = devices.some((d) =>
      sensorLikeTypes.includes(d.type)
    );

    // 1) Climate always wins (ACs, thermostats)
    if (hasClimate) return "dumio_ac";

    // 2) Pure lights
    if (hasLight) return "dumio_light";

    // 3) Smart switches / plugs: switch + any measurement/TH/battery sensor
    if (
      hasSwitch &&
      (hasPowerSensor || hasTemp || hasHumidity || hasSensorLike)
    ) {
      return "dumio_smart_switch";
    }

    // 4) Simple wall switches: only switch (no sensors)
    if (hasSwitch) return "dumio_switch";

    // 5) Only sensors (TH, power, motion, etc.)
    if (hasSensorLike) return "dumio_sensor";

    // 6) Fallbacks
    if (hasLight || hasSwitch) return "dumio_generic_switch";
    return "dumio_generic_sensor";
  }

  private static extractCapabilities(device: Device): CloudCapability[] {
    const capabilities: CloudCapability[] = [];
    const { status, type, capabilities: deviceCaps } = device;
    const { attributes } = status;

    if (deviceCaps.canTurnOn || deviceCaps.canTurnOff) {
      capabilities.push({
        capabilityType: "switch",
        valueType: "boolean",
        currentValue: { on: status.isOn ?? false },
        meta: { description: "Encender/Apagar" },
      });
    }
    if (deviceCaps.canDim && attributes.brightness !== undefined) {
      capabilities.push({
        capabilityType: "brightness",
        valueType: "number",
        currentValue: { value: attributes.brightness },
        meta: { min: 0, max: 100, unit: "%" },
      });
    }
    if (attributes.colorTemp !== undefined) {
      capabilities.push({
        capabilityType: "color_temp",
        valueType: "number",
        currentValue: { value: attributes.colorTemp },
        meta: { min: 2700, max: 6500, unit: "K" },
      });
    }
    if (deviceCaps.canChangeColor && attributes.color) {
      capabilities.push({
        capabilityType: "color",
        valueType: "object",
        currentValue: {
          r: attributes.color.r,
          g: attributes.color.g,
          b: attributes.color.b,
        },
        meta: null,
      });
    }
    if (
      attributes.temperature !== undefined ||
      attributes.currentTemperature !== undefined
    ) {
      const tempValue = attributes.currentTemperature ?? attributes.temperature;
      capabilities.push({
        capabilityType: "temperature",
        valueType: "number",
        currentValue: { value: tempValue },
        meta: { unit: attributes.unit ?? "°C" },
      });
    }
    if (attributes.humidity !== undefined) {
      capabilities.push({
        capabilityType: "humidity",
        valueType: "number",
        currentValue: { value: attributes.humidity },
        meta: { unit: "%" },
      });
    }
    if (attributes.battery !== undefined) {
      capabilities.push({
        capabilityType: "battery",
        valueType: "number",
        currentValue: { value: attributes.battery },
        meta: { min: 0, max: 100, unit: "%" },
      });
    }
    if (attributes.power !== undefined) {
      capabilities.push({
        capabilityType: "power",
        valueType: "number",
        currentValue: { value: attributes.power },
        meta: { unit: "W" },
      });
    }
    if (attributes.energy !== undefined) {
      capabilities.push({
        capabilityType: "energy",
        valueType: "number",
        currentValue: { value: attributes.energy },
        meta: { unit: "kWh" },
      });
    }
    if (deviceCaps.canSetPosition && attributes.position !== undefined) {
      capabilities.push({
        capabilityType: "position",
        valueType: "number",
        currentValue: { value: attributes.position },
        meta: { min: 0, max: 100, unit: "%" },
      });
    }
    if (deviceCaps.canSetVolume && attributes.volume !== undefined) {
      capabilities.push({
        capabilityType: "volume",
        valueType: "number",
        currentValue: { value: attributes.volume },
        meta: { min: 0, max: 100, unit: "%" },
      });
    }
    if (attributes.mode !== undefined) {
      capabilities.push({
        capabilityType: "mode",
        valueType: "string",
        currentValue: { value: attributes.mode },
        meta: null,
      });
    }
    if (attributes.preset !== undefined) {
      capabilities.push({
        capabilityType: "preset",
        valueType: "string",
        currentValue: { value: attributes.preset },
        meta: null,
      });
    }
    if (type === "binary_sensor") {
      const capabilityType = this.mapBinarySensorCapability(device);
      if (capabilityType) {
        capabilities.push({
          capabilityType,
          valueType: "boolean",
          currentValue: { on: status.isOn ?? false },
          meta: null,
        });
      }
    }
    if (type === "lock") {
      capabilities.push({
        capabilityType: "lock",
        valueType: "boolean",
        currentValue: { on: status.state === "locked" },
        meta: { description: "Bloqueado/Desbloqueado" },
      });
    }
    if (capabilities.length === 0) {
      capabilities.push(this.getDefaultCapability(device));
    }
    return capabilities;
  }

  private static mapBinarySensorCapability(
    device: Device
  ): CloudCapabilityType | null {
    switch (device.type) {
      case "motion":
        return "motion";
      case "door":
        return "door";
      case "window":
        return "window";
      default:
        return null;
    }
  }

  private static getDefaultCapability(device: Device): CloudCapability {
    const { status, type } = device;
    if (
      ["sensor", "temperature", "humidity", "power", "battery"].includes(type)
    ) {
      return {
        capabilityType: this.mapSensorType(type),
        valueType: "number",
        currentValue: { value: parseFloat(status.state) || 0 },
        meta: { unit: status.attributes.unit ?? "" },
      };
    }
    return {
      capabilityType: "switch",
      valueType: "boolean",
      currentValue: { on: status.isOn ?? false },
      meta: null,
    };
  }

  private static mapSensorType(type: DeviceType): CloudCapabilityType {
    const mapping: Partial<Record<DeviceType, CloudCapabilityType>> = {
      temperature: "temperature",
      humidity: "humidity",
      power: "power",
      battery: "battery",
      sensor: "sensor",
    };
    return mapping[type] ?? "sensor";
  }
}
