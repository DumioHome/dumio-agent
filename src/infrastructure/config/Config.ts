import dotenv from "dotenv";
import { readFileSync, existsSync } from "fs";
import type { LogLevel } from "../../domain/ports/ILogger.js";

// Load environment variables (for standalone mode)
dotenv.config();

export interface AppConfig {
  homeAssistant: {
    url: string;
    accessToken: string;
  };
  agent: {
    name: string;
    /** Dumio Device ID - if set, uses this ID instead of generating a random one */
    dumioDeviceId?: string;
  };
  cloud: {
    socketUrl: string;
    apiKey: string;
    enabled: boolean;
  };
  logging: {
    level: LogLevel;
    pretty: boolean;
  };
  reconnection: {
    interval: number;
    maxAttempts: number;
  };
  isAddon: boolean;
}

/**
 * Check if running as Home Assistant Add-on
 */
function isHomeAssistantAddon(): boolean {
  return existsSync("/data/options.json") || !!process.env.SUPERVISOR_TOKEN;
}

/**
 * Load add-on options from Home Assistant Supervisor
 */
function _loadAddonOptions(): Record<string, unknown> {
  const optionsPath = "/data/options.json";
  if (existsSync(optionsPath)) {
    try {
      const content = readFileSync(optionsPath, "utf-8");
      return JSON.parse(content);
    } catch {
      return {};
    }
  }
  return {};
}

function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvOrDefault(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Load configuration - supports both add-on and standalone modes
 *
 * For Add-on mode: run.sh reads config.yaml options via bashio and exports them as ENV vars
 * For Standalone mode: reads from .env file
 */
export function loadConfig(): AppConfig {
  const isAddon = isHomeAssistantAddon();

  if (isAddon) {
    // Running as Home Assistant Add-on
    // ENV vars are set by run.sh from config.yaml options via bashio
    const supervisorToken =
      process.env.SUPERVISOR_TOKEN ?? process.env.HA_ACCESS_TOKEN ?? "";
    const cloudSocketUrl = process.env.CLOUD_SOCKET_URL ?? "";
    const cloudApiKey = process.env.CLOUD_API_KEY ?? "";
    const dumioDeviceId = process.env.DUMIO_DEVICE_ID || undefined;

    return {
      homeAssistant: {
        // URL set by run.sh, defaults to internal Supervisor WebSocket URL
        url: process.env.HA_URL ?? "ws://supervisor/core/websocket",
        accessToken: supervisorToken,
      },
      agent: {
        name: getEnvOrDefault("AGENT_NAME", "dumio-agent"),
        dumioDeviceId,
      },
      cloud: {
        socketUrl: cloudSocketUrl,
        apiKey: cloudApiKey,
        enabled: !!cloudSocketUrl && !!cloudApiKey,
      },
      logging: {
        // Set by run.sh from config.yaml log_level option
        level: getEnvOrDefault("LOG_LEVEL", "info") as LogLevel,
        pretty: false, // Structured logging for add-on
      },
      reconnection: {
        // Set by run.sh from config.yaml options
        interval: getEnvNumber("RECONNECT_INTERVAL", 5000),
        maxAttempts: getEnvNumber("MAX_RECONNECT_ATTEMPTS", 10),
      },
      isAddon: true,
    };
  }

  // Standalone mode - reads from .env file
  const cloudSocketUrl = process.env.CLOUD_SOCKET_URL ?? "";
  const cloudApiKey = process.env.CLOUD_API_KEY ?? "";
  const dumioDeviceId = process.env.DUMIO_DEVICE_ID || undefined;

  return {
    homeAssistant: {
      url: getEnvOrThrow("HA_URL"),
      accessToken: getEnvOrThrow("HA_ACCESS_TOKEN"),
    },
    agent: {
      name: getEnvOrDefault("AGENT_NAME", "dumio-agent"),
      dumioDeviceId,
    },
    cloud: {
      socketUrl: cloudSocketUrl,
      apiKey: cloudApiKey,
      enabled: !!cloudSocketUrl && !!cloudApiKey,
    },
    logging: {
      level: getEnvOrDefault("LOG_LEVEL", "info") as LogLevel,
      pretty: process.env.NODE_ENV !== "production",
    },
    reconnection: {
      interval: getEnvNumber("RECONNECT_INTERVAL", 5000),
      maxAttempts: getEnvNumber("MAX_RECONNECT_ATTEMPTS", 10),
    },
    isAddon: false,
  };
}

/**
 * Validate configuration
 */
export function validateConfig(config: AppConfig): void {
  // Skip URL validation for add-on mode (uses internal supervisor URL)
  if (!config.isAddon) {
    if (
      !config.homeAssistant.url.startsWith("ws://") &&
      !config.homeAssistant.url.startsWith("wss://")
    ) {
      throw new Error("HA_URL must start with ws:// or wss://");
    }

    if (config.homeAssistant.accessToken.length < 10) {
      throw new Error(
        "HA_ACCESS_TOKEN seems too short. Please provide a valid long-lived access token."
      );
    }
  }

  // Validate that we have a token in add-on mode
  if (config.isAddon && !config.homeAssistant.accessToken) {
    throw new Error(
      "SUPERVISOR_TOKEN not available. Make sure the add-on has homeassistant_api: true"
    );
  }
}
