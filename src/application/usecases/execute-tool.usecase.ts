import type { ToolCall } from "../../domain/value-objects/tool-call.js";
import { errorMessage } from "../../shared/text.js";
import type { ToolRegistry } from "../services/tool-registry.js";

export interface ToolOutcome {
  ok: boolean;
  observation: string;
}

/**
 * Validates and dispatches a single tool call. Failures are returned as
 * observations so the model can recover instead of crashing the turn.
 */
export class ExecuteToolUseCase {
  constructor(private readonly registry: ToolRegistry) {}

  async execute(call: ToolCall): Promise<ToolOutcome> {
    const tool = this.registry.get(call.name);
    if (!tool) {
      return {
        ok: false,
        observation: `Unknown tool "${call.name}". Available tools: ${this.registry.names().join(", ") || "none"}.`,
      };
    }

    try {
      const observation = await tool.execute(call.args);
      return { ok: true, observation };
    } catch (error) {
      return {
        ok: false,
        observation: `Tool "${call.name}" failed: ${errorMessage(error)}`,
      };
    }
  }
}
