import { z } from "zod";
import type { SandboxPort } from "../../domain/ports/sandbox.port.js";
import type { ToolDefinition, ToolPort } from "../../domain/ports/tool.port.js";
import { singleLine } from "../../shared/text.js";
import { parseToolArgs } from "./parse-tool-args.js";

const argsSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    path: z.string().optional(),
    case_sensitive: z.boolean().optional(),
    max_results: z.number().int().min(1).max(100).optional(),
  })
  .strict();

const SKIP_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

const MAX_DIRECTORIES = 1_000;
const MAX_FILES = 3_000;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_LINE_CHARS = 240;

/**
 * Literal text search across workspace files. Binary, oversized, generated,
 * and dependency directories are skipped so a single call cannot scan an
 * entire node_modules tree.
 */
export class SearchFilesTool implements ToolPort {
  constructor(private readonly sandbox: SandboxPort) {}

  getDefinition(): ToolDefinition {
    return {
      name: "search_files",
      description:
        "Search text files in the workspace for a literal string. Returns path:line matches, skips node_modules/.git/build output and files over 256 KB, and caps results. Use this to locate code before reading or editing it.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Literal text to find, case-insensitive by default.",
          },
          path: {
            type: "string",
            description:
              "Directory to search, relative to the workspace root. Defaults to the root.",
          },
          case_sensitive: {
            type: "boolean",
            description: "Match case exactly. Defaults to false.",
          },
          max_results: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            description: "Maximum matching lines to return. Defaults to 50.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      risk: "read",
      requiresApproval: false,
    };
  }

  async execute(rawArgs: unknown): Promise<string> {
    const args = parseToolArgs(argsSchema, rawArgs);
    const start = args.path?.trim() || ".";
    const maxResults = args.max_results ?? 50;
    const needle = args.case_sensitive ? args.query : args.query.toLowerCase();
    const matches: string[] = [];
    const pending = [start];
    let directories = 0;
    let files = 0;
    let matchingFiles = 0;
    let stopped = false;

    while (pending.length > 0 && !stopped) {
      const dir = pending.pop() ?? ".";
      if (directories >= MAX_DIRECTORIES) {
        stopped = true;
        break;
      }
      directories += 1;

      const entries = await this.sandbox.list(dir);
      for (const entry of entries) {
        if (entry.type === "directory") {
          if (SKIP_DIRECTORIES.has(entry.name.toLowerCase())) {
            continue;
          }
          pending.push(entry.path);
          continue;
        }

        if (files >= MAX_FILES) {
          stopped = true;
          break;
        }
        files += 1;
        if ((entry.sizeBytes ?? 0) > MAX_FILE_BYTES) {
          continue;
        }

        let content: string;
        try {
          content = await this.sandbox.read(entry.path);
        } catch {
          continue;
        }

        let fileMatched = false;
        const lines = content.split(/\r?\n/);
        for (const [index, line] of lines.entries()) {
          const haystack = args.case_sensitive ? line : line.toLowerCase();
          if (!haystack.includes(needle)) {
            continue;
          }
          fileMatched = true;
          matches.push(
            `${entry.path}:${index + 1}: ${singleLine(line, MAX_LINE_CHARS)}`,
          );
          if (matches.length >= maxResults) {
            stopped = true;
            break;
          }
        }
        if (fileMatched) {
          matchingFiles += 1;
        }
        if (stopped) {
          break;
        }
      }
    }

    const scope = start === "." ? "the workspace" : `"${start}"`;
    if (matches.length === 0) {
      return `No matches for "${args.query}" in ${scope} (${files} file(s) checked).`;
    }

    return [
      `Found ${matches.length} match(es) for "${args.query}" in ${matchingFiles} file(s) under ${scope}.`,
      ...matches,
      ...(stopped
        ? [`…[search stopped at the result/file/directory limit; narrow the path or query]`]
        : []),
    ].join("\n");
  }
}
