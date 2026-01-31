import type {
  IHomeAssistantClient,
  EventHandler,
  StateChangeHandler,
} from '../../domain/ports/IHomeAssistantClient.js';
import type { ILogger } from '../../domain/ports/ILogger.js';

export interface SubscribeToEventsInput {
  eventType?: string;
  onEvent?: EventHandler;
  onStateChange?: StateChangeHandler;
}

export interface SubscribeToEventsOutput {
  subscriptionId: number;
  unsubscribe: () => Promise<void>;
}

/**
 * Use case for subscribing to Home Assistant events
 */
export class SubscribeToEvents {
  constructor(
    private readonly haClient: IHomeAssistantClient,
    private readonly logger: ILogger
  ) {}

  async execute(input: SubscribeToEventsInput = {}): Promise<SubscribeToEventsOutput> {
    this.logger.info('Executing SubscribeToEvents use case', {
      eventType: input.eventType,
    });

    try {
      // Register event handlers if provided
      if (input.onEvent) {
        this.haClient.onEvent(input.onEvent);
      }

      if (input.onStateChange) {
        this.haClient.onStateChange(input.onStateChange);
      }

      // Subscribe to events
      const subscriptionId = await this.haClient.subscribeEvents(input.eventType);

      this.logger.info('Subscribed to events', {
        subscriptionId,
        eventType: input.eventType ?? 'all',
      });

      // Return unsubscribe function for cleanup
      const unsubscribe = async (): Promise<void> => {
        if (input.onEvent) {
          this.haClient.offEvent(input.onEvent);
        }
        if (input.onStateChange) {
          this.haClient.offStateChange(input.onStateChange);
        }
        await this.haClient.unsubscribeEvents(subscriptionId);
        this.logger.info('Unsubscribed from events', { subscriptionId });
      };

      return {
        subscriptionId,
        unsubscribe,
      };
    } catch (error) {
      this.logger.error('Error subscribing to events', error);
      throw error;
    }
  }
}
