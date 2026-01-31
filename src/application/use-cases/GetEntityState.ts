import type { IHomeAssistantClient } from '../../domain/ports/IHomeAssistantClient.js';
import type { ILogger } from '../../domain/ports/ILogger.js';
import type { EntityState, EntityFilter } from '../../domain/entities/Entity.js';
import { getEntityDomain } from '../../domain/entities/Entity.js';

export interface GetEntityStateInput {
  entityId?: string;
  filter?: EntityFilter;
}

export interface GetEntityStateOutput {
  entities: EntityState[];
  count: number;
}

/**
 * Use case for getting entity states
 */
export class GetEntityState {
  constructor(
    private readonly haClient: IHomeAssistantClient,
    private readonly logger: ILogger
  ) {}

  async execute(input: GetEntityStateInput = {}): Promise<GetEntityStateOutput> {
    this.logger.info('Executing GetEntityState use case', {
      entityId: input.entityId,
      filter: input.filter,
    });

    try {
      const allStates = await this.haClient.getStates();
      let filteredStates = allStates;

      // Filter by specific entity ID
      if (input.entityId) {
        filteredStates = allStates.filter(
          (state) => state.entity_id === input.entityId
        );
      }

      // Apply additional filters
      if (input.filter) {
        filteredStates = this.applyFilter(filteredStates, input.filter);
      }

      this.logger.debug('Entity states retrieved', {
        total: allStates.length,
        filtered: filteredStates.length,
      });

      return {
        entities: filteredStates,
        count: filteredStates.length,
      };
    } catch (error) {
      this.logger.error('Error getting entity states', error);
      throw error;
    }
  }

  private applyFilter(states: EntityState[], filter: EntityFilter): EntityState[] {
    let result = states;

    // Filter by domain
    if (filter.domain) {
      result = result.filter(
        (state) => getEntityDomain(state.entity_id) === filter.domain
      );
    }

    // Filter by entity IDs
    if (filter.entityIds && filter.entityIds.length > 0) {
      result = result.filter(
        (state) => filter.entityIds!.includes(state.entity_id)
      );
    }

    // Filter by state value
    if (filter.stateEquals !== undefined) {
      result = result.filter(
        (state) => state.state === filter.stateEquals
      );
    }

    // Filter by attribute
    if (filter.attributeFilter) {
      result = result.filter(
        (state) =>
          state.attributes[filter.attributeFilter!.key] ===
          filter.attributeFilter!.value
      );
    }

    return result;
  }
}
