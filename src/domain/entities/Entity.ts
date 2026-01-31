/**
 * Represents a Home Assistant entity state
 */
export interface EntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
  context: {
    id: string;
    parent_id: string | null;
    user_id: string | null;
  };
}

/**
 * Represents the domain of an entity (light, switch, sensor, etc.)
 */
export type EntityDomain =
  | 'light'
  | 'switch'
  | 'sensor'
  | 'binary_sensor'
  | 'climate'
  | 'cover'
  | 'fan'
  | 'media_player'
  | 'automation'
  | 'script'
  | 'scene'
  | 'input_boolean'
  | 'input_number'
  | 'input_text'
  | 'input_select'
  | 'person'
  | 'zone'
  | 'device_tracker'
  | string;

/**
 * Extracts the domain from an entity_id
 */
export function getEntityDomain(entityId: string): EntityDomain {
  const [domain] = entityId.split('.');
  return domain as EntityDomain;
}

/**
 * Entity filter criteria
 */
export interface EntityFilter {
  domain?: EntityDomain;
  entityIds?: string[];
  stateEquals?: string;
  attributeFilter?: {
    key: string;
    value: unknown;
  };
}
