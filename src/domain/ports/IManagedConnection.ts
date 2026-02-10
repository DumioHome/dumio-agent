/**
 * Estado de salud de una conexión persistente.
 * CONNECTED = operativa; DEGRADED = en transición o con fallos leves;
 * OFFLINE = desconectada o error. Permite políticas de reconexión y resync.
 */
export type ConnectionHealthState = "CONNECTED" | "DEGRADED" | "OFFLINE";

/**
 * Contrato para una conexión gestionada por ConnectionManager.
 * Cada conexión (HA, Cloud, futuras MQTT/Matter) debe implementar heartbeat,
 * detección de silencio/timeout y errores de escritura; ante fallo debe
 * cerrar socket, reconectar y reautenticar. El manager orquesta resync tras reconexión.
 */
export interface IManagedConnection {
  readonly name: string;

  /** Estado actual de salud para dashboards y decisiones */
  getHealthState(): ConnectionHealthState;

  /** Inicia la conexión y el healthcheck (heartbeat/timeout) */
  start(): Promise<void>;

  /** Detiene conexión y healthcheck sin reconectar */
  stop(): Promise<void>;

  /** Cierra el socket actual y abre uno nuevo (reconexión explícita) */
  forceReconnect(): Promise<void>;

  /** Se invoca cuando la conexión deja de ser saludable (timeout, error de escritura, cierre) */
  onUnhealthy(handler: () => void): void;

  /** Se invoca cuando la reconexión fue exitosa (para ejecutar resync de estados) */
  onReconnected(handler: () => void | Promise<void>): void;
}
