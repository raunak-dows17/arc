import { z } from "zod";
import type { SandboxPort } from "../../domain/ports/sandbox.port.js";
import type { ToolDefinition, ToolPort } from "../../domain/ports/tool.port.js";
import { parseToolArgs } from "./parse-tool-args.js";

const argsSchema = z
  .object({
    path: z.string().min(1),
    start_line: z.number().int().min(1).optional(),
    line_count: z.number().int().min(1).max(500).optional(),
  })
  .strict();

export class ReadFileTool implements ToolPort {
  constructor(private readonly sandbox: SandboxPort) {}

  getDefinition(): ToolDefinition {
    return {
      name: "read_file",
      description:
        "Read a text file from the sandbox, returned with line numbers. Use start_line/line_count for large files.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path relative to the sandbox root.",
          },
          start_line: {
            type: "integer",
            minimum: 1,
            description: "1-based line to start reading. Defaults to 1.",
          },
          line_count: {
            type: "integer",
            minimum: 1,
            maximum: 500,
            description: "Number of lines to return. Defaults to 200.",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    };
  }

  async execute(rawArgs: unknown): Promise<string> {
    const args = parseToolArgs(argsSchema, rawArgs);
    const content = await this.sandbox.read(args.path);

    if (content.length === 0) {
      return `"${args.path}" is empty (0 bytes).`;
    }

    const lines = content.split(/\r?\n/);
    if (lines.at(-1) === "") {
      lines.pop();
    }

    const startIndex = (args.start_line ?? 1) - 1;
    if (startIndex >= lines.length) {
      return `"${args.path}" has ${lines.length} line(s); start_line ${startIndex + 1} is past the end.`;
    }

    const lineCount = args.line_count ?? 200;
    const slice = lines.slice(startIndex, startIndex + lineCount);
    const numbered = slice
      .map((line, index) => `${startIndex + index + 1} | ${line}`)
      .join("\n");
    const remaining = lines.length - (startIndex + slice.length);

    const header = `"${args.path}" (lines ${startIndex + 1}-${startIndex + slice.length} of ${lines.length}):`;
    if (remaining > 0) {
      return `${header}\n${numbered}\n… ${remaining} more line(s); use start_line to continue.`;
    }
    return `${header}\n${numbered}`;
  }
}
