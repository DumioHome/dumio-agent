import type { IHomeAssistantClient } from '../../domain/ports/IHomeAssistantClient.js';
import type { ILogger } from '../../domain/ports/ILogger.js';

export interface ConnectToHomeAssistantInput {
  subscribeToStateChanges?: boolean;
}

export interface ConnectToHomeAssistantOutput {
  connected: boolean;
  haVersion: string | null;
  entityCount?: number;
}

/**
 * Use case for connecting to Home Assistant
 */
export class ConnectToHomeAssistant {
  constructor(
    private readonly haClient: IHomeAssistantClient,
    private readonly logger: ILogger
  ) {}

  async execute(input: ConnectToHomeAssistantInput = {}): Promise<ConnectToHomeAssistantOutput> {
    this.logger.info('Executing ConnectToHomeAssistant use case');

    try {
      // Connect to Home Assistant
      await this.haClient.connect();

      let entityCount: number | undefined;

      // Subscribe to state changes if requested
      if (input.subscribeToStateChanges) {
        await this.haClient.subscribeEvents('state_changed');
        
        // Fetch initial states
        const states = await this.haClient.getStates();
        entityCount = states.length;
        this.logger.info('Fetched initial states', { count: entityCount });
      }

      return {
        connected: true,
        haVersion: this.haClient.haVersion,
        entityCount,
      };
    } catch (error) {
      this.logger.error('Failed to connect to Home Assistant', error);
      throw error;
    }
  }
}
