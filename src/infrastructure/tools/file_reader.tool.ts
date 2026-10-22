import * as fs from "fs";
import * as path from "path";
import type { ToolDefinition, ToolPort } from "../../domain/ports/tool.port.js";
import type { ToolCallVO } from "../../domain/value_objects/tool_call.vo.js";

export class FileReaderTool implements ToolPort {
  private readonly allowedSandboxDir: string;

  constructor() {
    this.allowedSandboxDir = path.resolve(process.cwd(), "agent_sandbox");
  }

  public getDefinition(): ToolDefinition {
    return {
      name: "file_reader",
      description:
        "Reads and displays the complete raw string text content from a sandboxed file.",
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "The raw target name of the file to load",
          },
        },
        required: ["filename"],
      },
    };
  }

  public async execute(toolCall: ToolCallVO): Promise<string> {
    const filename = toolCall.arguments.filename;
    const safePath = path.join(this.allowedSandboxDir, path.basename(filename));

    if (!fs.existsSync(safePath)) {
      return `Error: Resource target [${filename}] was not found inside sandbox boundaries.`;
    }

    try {
      const data = await fs.promises.readFile(safePath, "utf-8");
      return `File Content from [${filename}]:\n\n${data}`;
    } catch (error: any) {
      return `IO Error: Read instruction pipeline tracking failure: ${error.message}`;
    }
  }
}
