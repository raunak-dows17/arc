import type { AgentProfile } from "../../domain/entities/agent-profile.js";
import type { ApprovalPort } from "../../domain/ports/approval.port.js";
import type {
  ToolDefinition,
  ToolExecutionContext,
} from "../../domain/ports/tool.port.js";
import type { ToolCall } from "../../domain/value-objects/tool-call.js";
import { errorMessage } from "../../shared/text.js";
import type { ToolRegistry } from "../services/tool-registry.js";

export interface ToolOutcome {
  ok: boolean;
  observation: string;
}

/**
 * Validates and dispatches a single tool call. Profile allowlists are enforced
 * here as well as in the prompt, so a hallucinated tool name cannot escape the
 * child's read-only boundary. Tools marked with requiresApproval fail closed
 * when no human approval channel is available. Failures are observations, not
 * crashes.
 */
export class ExecuteToolUseCase {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly approval?: ApprovalPort,
  ) {}

  async execute(
    call: ToolCall,
    context?: ToolExecutionContext,
    profile?: AgentProfile,
  ): Promise<ToolOutcome> {
    if (profile) {
      const blocked = this.blockedReason(call.name, profile);
      if (blocked) {
        return { ok: false, observation: blocked };
      }
      if (!profile.allowsTool(call.name)) {
        return {
          ok: false,
          observation: `Tool "${call.name}" is not available to the "${profile.id}" profile. Available tools: ${this.availableNames(profile).join(", ")}.`,
        };
      }
    }

    const tool = this.registry.get(call.name);
    if (!tool) {
      return {
        ok: false,
        observation: `Unknown tool "${call.name}". Available tools: ${this.availableNames(profile).join(", ") || "none"}.`,
      };
    }

    const effectiveContext: ToolExecutionContext =
      context ?? {
        sessionId: "unknown",
        agentId: profile?.id ?? "arc",
        depth: 0,
        ...(profile ? { allowedSkills: profile.skills } : {}),
      };

    const definition = tool.getDefinition();
    if (definition.requiresApproval) {
      const denial = await this.requestApproval(call, definition, effectiveContext);
      if (denial) {
        return { ok: false, observation: denial };
      }
    }

    try {
      const observation = await tool.execute(call.args, effectiveContext);
      return { ok: true, observation };
    } catch (error) {
      return {
        ok: false,
        observation: `Tool "${call.name}" failed: ${errorMessage(error)}`,
      };
    }
  }

  private async requestApproval(
    call: ToolCall,
    definition: ToolDefinition,
    context: ToolExecutionContext,
  ): Promise<string | null> {
    if (!this.approval) {
      return `Tool "${call.name}" requires human approval, but no approval channel is available.`;
    }

    const decision = await this.approval.request(
      {
        toolName: call.name,
        args: call.args,
        risk: definition.risk ?? "read",
        reason: definition.description,
        channel: context.channel ?? "cli",
        sessionId: context.sessionId,
        ...(context.turnId ? { turnId: context.turnId } : {}),
      },
      context.signal,
    );

    if (decision.approved) {
      return null;
    }

    return `Approval denied for "${call.name}" (${decision.decidedBy})${decision.reason ? `: ${decision.reason}` : "."}`;
  }

  private blockedReason(name: string, profile: AgentProfile): string | null {
    if (name === "write_file" && profile.readOnly) {
      return `Profile "${profile.id}" is read-only; write_file is blocked.`;
    }
    if (name === "remember" && !profile.memoryWrite) {
      return `Profile "${profile.id}" may not write memory; remember is blocked.`;
    }
    if (name === "run_agent" && !profile.canSpawn) {
      return `Profile "${profile.id}" may not spawn sub-agents; run_agent is blocked.`;
    }
    return null;
  }

  private availableNames(profile?: AgentProfile): string[] {
    return profile
      ? this.registry.names().filter((name) => profile.allowsTool(name))
      : this.registry.names();
  }
}
