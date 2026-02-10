import type { IHomeAssistantClient } from "../../domain/ports/IHomeAssistantClient.js";
import type { ILogger } from "../../domain/ports/ILogger.js";

/**
 * Input for UpdateEntityName use case
 */
export interface UpdateEntityNameInput {
  /** Entity ID to update */
  entityId: string;
  /** New friendly name */
  name: string;
}

/**
 * Output for UpdateEntityName use case
 */
export interface UpdateEntityNameOutput {
  success: boolean;
  message: string;
  error?: string;
}

/**
 * Use case for updating entity friendly name in Home Assistant
 * Simple and direct - just updates the entity registry name
 */
export class UpdateEntityName {
  constructor(
    private readonly haClient: IHomeAssistantClient,
    private readonly logger: ILogger
  ) {}

  async execute(input: UpdateEntityNameInput): Promise<UpdateEntityNameOutput> {
    const { entityId, name } = input;

    this.logger.info("Executing UpdateEntityName use case", {
      entityId,
      name,
    });

    try {
      // Validate input
      if (!entityId || !entityId.trim()) {
        return {
          success: false,
          message: "Entity ID is required",
          error: "Missing entityId",
        };
      }

      if (!name || !name.trim()) {
        return {
          success: false,
          message: "Name is required",
          error: "Missing name",
        };
      }

      // Update entity registry
      const command = {
        type: "config/entity_registry/update",
        entity_id: entityId,
        name: name.trim(),
      };

      this.logger.debug("Sending entity registry update command", {
        entityId,
        name: name.trim(),
        command: JSON.stringify(command),
      });

      const result = await this.haClient.sendCommand(
        command as Parameters<typeof this.haClient.sendCommand>[0]
      );

      this.logger.debug("Entity registry update response", {
        entityId,
        success: result.success,
        error: result.error,
        result: result.result,
      });

      if (!result.success) {
        const errorMessage =
          result.error?.message ?? "Failed to update entity registry";
        this.logger.error("Entity registry update failed", {
          entityId,
          name: name.trim(),
          error: errorMessage,
          errorCode: result.error?.code,
        });
        return {
          success: false,
          message: `Failed to update entity name: ${errorMessage}`,
          error: errorMessage,
        };
      }

      this.logger.info("Entity name updated successfully", {
        entityId,
        name: name.trim(),
      });

      return {
        success: true,
        message: `Entity name updated successfully to "${name.trim()}"`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("UpdateEntityName failed", {
        entityId,
        name,
        error: errorMessage,
        errorStack: error instanceof Error ? error.stack : undefined,
      });
      return {
        success: false,
        message: `Failed to update entity name: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }
}
