import { z } from "zod";
import { ToolValidationError } from "../../domain/errors/agent.errors.js";
import type { SandboxPort } from "../../domain/ports/sandbox.port.js";
import type { ToolDefinition, ToolPort } from "../../domain/ports/tool.port.js";
import { parseToolArgs } from "./parse-tool-args.js";

const argsSchema = z
  .object({
    path: z.string().min(1),
    old_string: z.string().min(1).max(20_000),
    new_string: z.string().max(100_000),
    replace_all: z.boolean().optional(),
  })
  .strict();

/**
 * Exact-string editing for localised changes. Requiring a unique match (unless
 * replace_all is explicit) makes accidental broad edits much less likely than
 * a regex-based patcher.
 */
export class ReplaceInFileTool implements ToolPort {
  constructor(private readonly sandbox: SandboxPort) {}

  getDefinition(): ToolDefinition {
    return {
      name: "replace_in_file",
      description:
        "Replace an exact string in one text file. By default old_string must match exactly once; set replace_all to replace every occurrence. Use this for small, localised edits. Read the file first.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path relative to the workspace root.",
          },
          old_string: {
            type: "string",
            description:
              "Exact text to replace, including whitespace. Must be unique unless replace_all is true.",
          },
          new_string: {
            type: "string",
            description: "Replacement text. Use an empty string to delete.",
          },
          replace_all: {
            type: "boolean",
            description: "Replace every occurrence instead of requiring one.",
          },
        },
        required: ["path", "old_string", "new_string"],
        additionalProperties: false,
      },
      risk: "workspace-write",
      requiresApproval: false,
    };
  }

  async execute(rawArgs: unknown): Promise<string> {
    const args = parseToolArgs(argsSchema, rawArgs);
    if (args.old_string === args.new_string) {
      return `No change: old_string and new_string are identical in "${args.path}".`;
    }

    const content = await this.sandbox.read(args.path);
    const count = countOccurrences(content, args.old_string);
    if (count === 0) {
      throw new ToolValidationError(
        `old_string was not found in "${args.path}". Read the file and copy the exact text, including whitespace.`,
      );
    }
    if (count > 1 && !args.replace_all) {
      throw new ToolValidationError(
        `old_string matches ${count} times in "${args.path}". Add more surrounding context or set replace_all to true.`,
      );
    }

    const next = args.replace_all
      ? content.split(args.old_string).join(args.new_string)
      : content.replace(args.old_string, args.new_string);
    const { bytes } = await this.sandbox.write(args.path, next);
    const replaced = args.replace_all ? count : 1;
    return `Replaced ${replaced} occurrence(s) in "${args.path}". The file is now ${bytes} bytes.`;
  }
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = 0;
  while (true) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) {
      return count;
    }
    count += 1;
    index = found + needle.length;
  }
}
