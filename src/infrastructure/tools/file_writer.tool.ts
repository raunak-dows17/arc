import type { ToolDefinition, ToolPort } from "../../domain/ports/tool.port.js";
import type { ToolCallVO } from "../../domain/value_objects/tool_call.vo.js";
import { FileRecoveryStore } from "../persistence/file-recovery.store.js";

export class FileWriterTool implements ToolPort {
  constructor(private readonly recoveryStore = new FileRecoveryStore()) {}

  public getDefinition(): ToolDefinition {
    return {
      name: "file_writer",
      description:
        "Writes text content directly to a specific file inside the sandboxed directory.",
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description:
              "The clean relative target filename (e.g., report.txt)",
          },
          content: {
            type: "string",
            description: "The absolute string data to write into the file",
          },
        },
        required: ["filename", "content"],
      },
    };
  }

  public async execute(toolCall: ToolCallVO): Promise<string> {
    try {
      const result = await this.recoveryStore.writeAndVerify(
        toolCall.arguments.filename,
        toolCall.arguments.content,
      );
      return `Success: Wrote and verified sandbox file [${result.filename}]. Recovery action ID: ${result.actionId}.`;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error: File write failed. ${message}`;
    }
  }
}
