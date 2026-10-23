import { z } from "zod";
import type { MemoryStorePort } from "../../domain/ports/memory-store.port.js";
import type { ToolDefinition, ToolPort } from "../../domain/ports/tool.port.js";
import { parseToolArgs } from "./parse-tool-args.js";

const searchSchema = z
  .object({
    query: z.string().trim().min(1),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();

const getSchema = z
  .object({
    path: z.string().trim().min(1),
    start_line: z.number().int().min(1).optional(),
    line_count: z.number().int().min(1).max(500).optional(),
  })
  .strict();

export class MemorySearchTool implements ToolPort {
  constructor(private readonly memory: MemoryStorePort) {}

  getDefinition(): ToolDefinition {
    return {
      name: "memory_search",
      description:
        "Search the user's Markdown memory (USER.md, MEMORY.md, and daily notes) by keywords. Use this before asking the user to repeat a preference.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keywords to search for." },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 20,
            description: "Maximum results. Defaults to 5.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    };
  }

  async execute(rawArgs: unknown): Promise<string> {
    const args = parseToolArgs(searchSchema, rawArgs);
    const results = await this.memory.search(args.query, args.limit ?? 5);
    if (results.length === 0) {
      return `No memory matches for "${args.query}".`;
    }

    return [
      `Memory matches for "${args.query}":`,
      ...results.map(
        (result) =>
          `- ${result.path} · ${result.title} (score ${result.score})\n  ${result.snippet}`,
      ),
    ].join("\n");
  }
}

export class MemoryGetTool implements ToolPort {
  constructor(private readonly memory: MemoryStorePort) {}

  getDefinition(): ToolDefinition {
    return {
      name: "memory_get",
      description:
        "Read a memory file by path relative to the memory directory (for example USER.md, MEMORY.md, daily/2026-10-23.md).",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Memory path relative to the memory directory.",
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
            description: "Number of lines. Defaults to 200.",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    };
  }

  async execute(rawArgs: unknown): Promise<string> {
    const args = parseToolArgs(getSchema, rawArgs);
    return this.memory.get(
      args.path,
      args.start_line ?? 1,
      args.line_count ?? 200,
    );
  }
}
