import { z } from "zod";
import type { SubAgentRunnerPort } from "../../domain/ports/sub-agent-runner.port.js";
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolPort,
} from "../../domain/ports/tool.port.js";
import { ToolValidationError } from "../../domain/errors/agent.errors.js";
import { truncateText } from "../../shared/text.js";
import { parseToolArgs } from "./parse-tool-args.js";

const argsSchema = z
  .object({
    agent: z.string().trim().min(1),
    task: z.string().trim().min(1).max(8_000),
    context: z.string().max(6_000).optional(),
  })
  .strict();

/**
 * Sequential delegation. The parent turn blocks until the child finishes. The
 * result is a compact summary, not the child's full transcript.
 */
export class RunAgentTool implements ToolPort {
  constructor(private readonly runner: SubAgentRunnerPort) {}

  getDefinition(): ToolDefinition {
    return {
      name: "run_agent",
      description:
        "Delegate one self-contained task to a bounded sub-agent (researcher, reviewer, or writer). This blocks until it finishes and returns a compact summary. Cannot be nested.",
      parameters: {
        type: "object",
        properties: {
          agent: {
            type: "string",
            description: "Profile id, e.g. researcher, reviewer, or writer.",
          },
          task: {
            type: "string",
            description: "A clear, self-contained task with the expected output.",
          },
          context: {
            type: "string",
            description:
              "Relevant context the child cannot see because it has an isolated transcript.",
          },
        },
        required: ["agent", "task"],
        additionalProperties: false,
      },
    };
  }

  async execute(
    rawArgs: unknown,
    context?: ToolExecutionContext,
  ): Promise<string> {
    const args = parseToolArgs(argsSchema, rawArgs);
    if (!context) {
      throw new ToolValidationError(
        "run_agent requires an active session context.",
      );
    }

    const result = await this.runner.run({
      parentSessionId: context.sessionId,
      parentAgentId: context.agentId,
      parentDepth: context.depth,
      agentId: args.agent,
      task: args.task,
      ...(args.context ? { context: args.context } : {}),
      ...(context.signal ? { signal: context.signal } : {}),
    });

    const header = `Sub-agent "${args.agent}" ${result.status} · run ${result.runId} · session ${result.childSessionId} · ${result.steps} tool call(s).`;
    return `${header}\n\n${truncateText(result.summary, 3_000)}`;
  }
}
