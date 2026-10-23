import { z } from "zod";
import type { SandboxPort } from "../../domain/ports/sandbox.port.js";
import type { ToolDefinition, ToolPort } from "../../domain/ports/tool.port.js";
import { parseToolArgs } from "./parse-tool-args.js";

const argsSchema = z
  .object({
    path: z.string().min(1),
    content: z.string(),
  })
  .strict();

export class WriteFileTool implements ToolPort {
  constructor(private readonly sandbox: SandboxPort) {}

  getDefinition(): ToolDefinition {
    return {
      name: "write_file",
      description:
        "Create or overwrite a text file in the sandbox. The content is the complete file; parent directories are created automatically.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path relative to the sandbox root.",
          },
          content: {
            type: "string",
            description: "Complete text content to write to the file.",
          },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    };
  }

  async execute(rawArgs: unknown): Promise<string> {
    const args = parseToolArgs(argsSchema, rawArgs);
    const { bytes } = await this.sandbox.write(args.path, args.content);
    return `Wrote ${bytes} bytes to "${args.path}".`;
  }
}
