import type { ToolDefinition, ToolPort } from "../../domain/ports/tool.port.js";
import type { ToolCallVO } from "../../domain/value_objects/tool_call.vo.js";
import { FileRecoveryStore } from "../persistence/file-recovery.store.js";

export class UndoFileWriteTool implements ToolPort {
  constructor(private readonly recoveryStore = new FileRecoveryStore()) {}

  public getDefinition(): ToolDefinition {
    return {
      name: "undo_file_write",
      description:
        "Restores the exact prior contents of a file changed by this agent run. Only use a recovery action ID returned by file_writer after verification fails or rollback is explicitly requested.",
      parameters: {
        type: "object",
        properties: {
          actionId: {
            type: "string",
            description: "Recovery action ID returned by file_writer",
          },
        },
        required: ["actionId"],
      },
    };
  }

  public async execute(toolCall: ToolCallVO): Promise<string> {
    try {
      const result = await this.recoveryStore.rollback(
        toolCall.arguments.actionId,
      );
      return `Success: Verified rollback of file [${result.filename}] for recovery action [${result.actionId}].`;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error: File rollback failed. ${message}`;
    }
  }
}
