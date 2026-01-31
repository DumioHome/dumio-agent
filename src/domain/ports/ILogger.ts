/**
 * Log levels supported by the logger
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Port interface for logging
 * Allows swapping logging implementations
 */
export interface ILogger {
  /**
   * Log at trace level
   */
  trace(message: string, data?: Record<string, unknown>): void;

  /**
   * Log at debug level
   */
  debug(message: string, data?: Record<string, unknown>): void;

  /**
   * Log at info level
   */
  info(message: string, data?: Record<string, unknown>): void;

  /**
   * Log at warn level
   */
  warn(message: string, data?: Record<string, unknown>): void;

  /**
   * Log at error level
   */
  error(message: string, error?: Error | unknown, data?: Record<string, unknown>): void;

  /**
   * Log at fatal level
   */
  fatal(message: string, error?: Error | unknown, data?: Record<string, unknown>): void;

  /**
   * Create a child logger with additional context
   */
  child(bindings: Record<string, unknown>): ILogger;
}
