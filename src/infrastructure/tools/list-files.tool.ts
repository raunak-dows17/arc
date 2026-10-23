import { z } from "zod";
import type { SandboxPort } from "../../domain/ports/sandbox.port.js";
import type { ToolDefinition, ToolPort } from "../../domain/ports/tool.port.js";
import { parseToolArgs } from "./parse-tool-args.js";

const argsSchema = z
  .object({
    path: z.string().optional(),
  })
  .strict();

export class ListFilesTool implements ToolPort {
  constructor(private readonly sandbox: SandboxPort) {}

  getDefinition(): ToolDefinition {
    return {
      name: "list_files",
      description:
        "List files and directories inside one directory of the sandbox. Use \".\" for the sandbox root. Paths are relative to the sandbox root.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Directory path relative to the sandbox root. Use \".\" for the root (default).",
          },
        },
        additionalProperties: false,
      },
    };
  }

  async execute(rawArgs: unknown): Promise<string> {
    const args = parseToolArgs(argsSchema, rawArgs);
    const relativeDir = args.path?.trim() || ".";
    const entries = await this.sandbox.list(relativeDir);

    if (entries.length === 0) {
      return `No files or directories found in "${relativeDir}".`;
    }

    const lines = entries.map((entry) =>
      entry.type === "directory"
        ? `[dir]  ${entry.path}/`
        : `[file] ${entry.path} (${entry.sizeBytes ?? 0} bytes)`,
    );

    if (entries.length >= 500) {
      lines.push("…[list truncated at 500 entries]");
    }

    return [`Contents of "${relativeDir}":`, ...lines].join("\n");
  }
}
