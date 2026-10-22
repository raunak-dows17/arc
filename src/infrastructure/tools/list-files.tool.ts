import * as fs from "fs";
import * as path from "path";
import type { ToolDefinition, ToolPort } from "../../domain/ports/tool.port.js";
import type { ToolCallVO } from "../../domain/value_objects/tool_call.vo.js";

export class ListFilesTool implements ToolPort {
  private readonly allowedSandboxDir: string;

  constructor() {
    this.allowedSandboxDir = path.resolve(process.cwd(), "agent_sandbox");
  }

  public getDefinition(): ToolDefinition {
    return {
      name: "list_files",
      description:
        "Retrieves an array catalog listing all active files residing inside the sandboxed workspace ecosystem.",
      parameters: {
        type: "object",
        properties: {},
      },
    };
  }

  public async execute(_toolCall: ToolCallVO): Promise<string> {
    try {
      if (!fs.existsSync(this.allowedSandboxDir)) {
        return "Notice: Sandbox environment directory contains zero records.";
      }

      const files = (await fs.promises.readdir(this.allowedSandboxDir)).filter(
        (filename) => filename !== ".agent_recovery",
      );
      if (files.length === 0) {
        return "Sandbox layout status: Workspace directory is currently empty.";
      }

      return `Available files within target workspace context:\n- ${files.join("\n- ")}`;
    } catch (error: any) {
      return `Directory Inspection Error: Failed to catalog working index metadata: ${error.message}`;
    }
  }
}
