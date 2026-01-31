import type { IHomeAssistantClient } from '../../domain/ports/IHomeAssistantClient.js';
import type { ILogger } from '../../domain/ports/ILogger.js';

export interface CallServiceInput {
  domain: string;
  service: string;
  entityId?: string | string[];
  data?: Record<string, unknown>;
}

export interface CallServiceOutput {
  success: boolean;
  message: string;
}

/**
 * Use case for calling a Home Assistant service
 */
export class CallService {
  constructor(
    private readonly haClient: IHomeAssistantClient,
    private readonly logger: ILogger
  ) {}

  async execute(input: CallServiceInput): Promise<CallServiceOutput> {
    this.logger.info('Executing CallService use case', {
      domain: input.domain,
      service: input.service,
      entityId: input.entityId,
    });

    // Validate input
    if (!input.domain || !input.service) {
      throw new Error('Domain and service are required');
    }

    try {
      const target = input.entityId
        ? { entity_id: input.entityId }
        : undefined;

      const result = await this.haClient.callService(
        input.domain,
        input.service,
        input.data,
        target
      );

      if (result.success) {
        const message = `Service ${input.domain}.${input.service} called successfully`;
        this.logger.info(message);
        return { success: true, message };
      } else {
        const message = result.error?.message ?? 'Service call failed';
        this.logger.warn('Service call failed', { error: result.error });
        return { success: false, message };
      }
    } catch (error) {
      this.logger.error('Error calling service', error);
      throw error;
    }
  }
}
