import { z } from "zod";
import type { EventBusPort } from "../../domain/events/agent-event.js";
import type { MemoryStorePort } from "../../domain/ports/memory-store.port.js";
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolPort,
} from "../../domain/ports/tool.port.js";
import { parseToolArgs } from "./parse-tool-args.js";

const argsSchema = z
  .object({
    content: z.string().trim().min(1).max(4_000),
    scope: z.enum(["long-term", "daily"]).optional(),
  })
  .strict();

export class RememberTool implements ToolPort {
  constructor(
    private readonly memory: MemoryStorePort,
    private readonly events?: EventBusPort,
  ) {}

  getDefinition(): ToolDefinition {
    return {
      name: "remember",
      description:
        "Save a durable fact, preference, or decision to Markdown memory. Use long-term for durable facts and daily for a dated note.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The fact or note to remember. Keep it short and specific.",
          },
          scope: {
            type: "string",
            enum: ["long-term", "daily"],
            description: "Where to store it. Defaults to long-term.",
          },
        },
        required: ["content"],
        additionalProperties: false,
      },
    };
  }

  async execute(
    rawArgs: unknown,
    context?: ToolExecutionContext,
  ): Promise<string> {
    const args = parseToolArgs(argsSchema, rawArgs);
    const scope = args.scope ?? "long-term";
    const result = await this.memory.remember(args.content, scope);
    this.events?.emit("memory.written", {
      sessionId: context?.sessionId ?? "unknown",
      agentId: context?.agentId ?? "arc",
      data: { path: result.path, scope, bytes: result.bytes },
    });
    return `Remembered in ${result.path}.`;
  }
}
