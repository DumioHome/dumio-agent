/**
 * Prefijo en la parte de nombre del entity_id para dispositivos oficiales Dumio.
 * Formato esperado: domain.dumio_plug_xxxx (por ejemplo: climate.dumio_plug_ac_living).
 */
export const DUMIO_OFFICIAL_ENTITY_PREFIX = "dumio_plug";

export function isDumioOfficialEntity(entityId: string): boolean {
  const [, name] = entityId.split(".");
  return typeof name === "string" && name.startsWith(DUMIO_OFFICIAL_ENTITY_PREFIX);
}
