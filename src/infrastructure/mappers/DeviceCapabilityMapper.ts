import type { Device, DeviceType } from "../../domain/entities/Device.js";
import type {
  CloudCapability,
  CloudCapabilityType,
} from "../../domain/entities/CloudDevice.js";

/**
 * Helper to extract capabilities from a device for cloud updates
 * This is used when sending device:update events to the cloud
 */
export class DeviceCapabilityMapper {
  /**
   * Extract capabilities from device based on its type and attributes
   */
  static extractCapabilities(device: Device): CloudCapability[] {
    const capabilities: CloudCapability[] = [];
    const { status, type, capabilities: deviceCaps } = device;
    const { attributes } = status;

    // Add switch capability for controllable devices
    if (deviceCaps.canTurnOn || deviceCaps.canTurnOff) {
      capabilities.push({
        capabilityType: "switch",
        valueType: "boolean",
        currentValue: { on: status.isOn ?? false },
        meta: { description: "Encender/Apagar" },
      });
    }

    // Add brightness capability
    if (deviceCaps.canDim && attributes.brightness !== undefined) {
      capabilities.push({
        capabilityType: "brightness",
        valueType: "number",
        currentValue: { value: attributes.brightness },
        meta: { min: 0, max: 100, unit: "%" },
      });
    }

    // Add color temperature capability
    if (attributes.colorTemp !== undefined) {
      capabilities.push({
        capabilityType: "color_temp",
        valueType: "number",
        currentValue: { value: attributes.colorTemp },
        meta: { min: 2700, max: 6500, unit: "K" },
      });
    }

    // Add color capability
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

    // Add temperature capability for sensors/climate
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

    // Add humidity capability
    if (attributes.humidity !== undefined) {
      capabilities.push({
        capabilityType: "humidity",
        valueType: "number",
        currentValue: { value: attributes.humidity },
        meta: { unit: "%" },
      });
    }

    // Add battery capability
    if (attributes.battery !== undefined) {
      capabilities.push({
        capabilityType: "battery",
        valueType: "number",
        currentValue: { value: attributes.battery },
        meta: { min: 0, max: 100, unit: "%" },
      });
    }

    // Add power capability
    if (attributes.power !== undefined) {
      capabilities.push({
        capabilityType: "power",
        valueType: "number",
        currentValue: { value: attributes.power },
        meta: { unit: "W" },
      });
    }

    // Add energy capability
    if (attributes.energy !== undefined) {
      capabilities.push({
        capabilityType: "energy",
        valueType: "number",
        currentValue: { value: attributes.energy },
        meta: { unit: "kWh" },
      });
    }

    // Add position capability for covers
    if (deviceCaps.canSetPosition && attributes.position !== undefined) {
      capabilities.push({
        capabilityType: "position",
        valueType: "number",
        currentValue: { value: attributes.position },
        meta: { min: 0, max: 100, unit: "%" },
      });
    }

    // Add volume capability for media players
    if (deviceCaps.canSetVolume && attributes.volume !== undefined) {
      capabilities.push({
        capabilityType: "volume",
        valueType: "number",
        currentValue: { value: attributes.volume },
        meta: { min: 0, max: 100, unit: "%" },
      });
    }

    // Add mode capability for climate devices
    if (attributes.mode !== undefined) {
      capabilities.push({
        capabilityType: "mode",
        valueType: "string",
        currentValue: { value: attributes.mode },
        meta: null,
      });
    }

    // Add preset capability
    if (attributes.preset !== undefined) {
      capabilities.push({
        capabilityType: "preset",
        valueType: "string",
        currentValue: { value: attributes.preset },
        meta: null,
      });
    }

    // Add binary sensor specific capabilities
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

    // Add lock capability
    if (type === "lock") {
      capabilities.push({
        capabilityType: "lock",
        valueType: "boolean",
        currentValue: { on: status.state === "locked" },
        meta: { description: "Bloqueado/Desbloqueado" },
      });
    }

    // If no capabilities were added, add a basic state capability based on type
    if (capabilities.length === 0) {
      capabilities.push(this.getDefaultCapability(device));
    }

    return capabilities;
  }

  /**
   * Map binary sensor device class to capability type
   */
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

  /**
   * Get default capability for devices without specific capabilities
   */
  private static getDefaultCapability(device: Device): CloudCapability {
    const { status, type } = device;

    // For sensors, return the state value with correct capabilityType
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

    // Default switch capability
    return {
      capabilityType: "switch",
      valueType: "boolean",
      currentValue: { on: status.isOn ?? false },
      meta: null,
    };
  }

  /**
   * Map device type to sensor capability type
   * This ensures that sensors with device_class power map to capabilityType "power"
   * and regular sensors map to capabilityType "sensor"
   */
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
