import dotenv from 'dotenv';
import type { LogLevel } from '../../domain/ports/ILogger.js';

// Load environment variables
dotenv.config();

export interface AppConfig {
  homeAssistant: {
    url: string;
    accessToken: string;
  };
  agent: {
    name: string;
  };
  logging: {
    level: LogLevel;
    pretty: boolean;
  };
  reconnection: {
    interval: number;
    maxAttempts: number;
  };
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
 * Load configuration from environment variables
 */
export function loadConfig(): AppConfig {
  return {
    homeAssistant: {
      url: getEnvOrThrow('HA_URL'),
      accessToken: getEnvOrThrow('HA_ACCESS_TOKEN'),
    },
    agent: {
      name: getEnvOrDefault('AGENT_NAME', 'dumio-agent'),
    },
    logging: {
      level: getEnvOrDefault('LOG_LEVEL', 'info') as LogLevel,
      pretty: process.env.NODE_ENV !== 'production',
    },
    reconnection: {
      interval: getEnvNumber('RECONNECT_INTERVAL', 5000),
      maxAttempts: getEnvNumber('MAX_RECONNECT_ATTEMPTS', 10),
    },
  };
}

/**
 * Validate configuration
 */
export function validateConfig(config: AppConfig): void {
  if (!config.homeAssistant.url.startsWith('ws://') && !config.homeAssistant.url.startsWith('wss://')) {
    throw new Error('HA_URL must start with ws:// or wss://');
  }

  if (config.homeAssistant.accessToken.length < 10) {
    throw new Error('HA_ACCESS_TOKEN seems too short. Please provide a valid long-lived access token.');
  }
}
