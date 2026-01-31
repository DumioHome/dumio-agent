import pino from 'pino';
import type { ILogger, LogLevel } from '../../domain/ports/ILogger.js';

/**
 * Pino-based logger implementation
 */
export class PinoLogger implements ILogger {
  private logger: pino.Logger;

  constructor(options?: {
    name?: string;
    level?: LogLevel;
    pretty?: boolean;
  }) {
    const transport = options?.pretty
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined;

    this.logger = pino({
      name: options?.name ?? 'dumio-agent',
      level: options?.level ?? 'info',
      ...(transport && { transport }),
    });
  }

  private constructor_child(pinoLogger: pino.Logger) {
    const instance = Object.create(PinoLogger.prototype) as PinoLogger;
    instance.logger = pinoLogger;
    return instance;
  }

  trace(message: string, data?: Record<string, unknown>): void {
    if (data) {
      this.logger.trace(data, message);
    } else {
      this.logger.trace(message);
    }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    if (data) {
      this.logger.debug(data, message);
    } else {
      this.logger.debug(message);
    }
  }

  info(message: string, data?: Record<string, unknown>): void {
    if (data) {
      this.logger.info(data, message);
    } else {
      this.logger.info(message);
    }
  }

  warn(message: string, data?: Record<string, unknown>): void {
    if (data) {
      this.logger.warn(data, message);
    } else {
      this.logger.warn(message);
    }
  }

  error(message: string, error?: Error | unknown, data?: Record<string, unknown>): void {
    const errorData = error instanceof Error
      ? { err: error, ...data }
      : { error, ...data };

    this.logger.error(errorData, message);
  }

  fatal(message: string, error?: Error | unknown, data?: Record<string, unknown>): void {
    const errorData = error instanceof Error
      ? { err: error, ...data }
      : { error, ...data };

    this.logger.fatal(errorData, message);
  }

  child(bindings: Record<string, unknown>): ILogger {
    const childLogger = this.logger.child(bindings);
    const instance = Object.create(PinoLogger.prototype) as PinoLogger;
    instance.logger = childLogger;
    return instance;
  }
}
