import type { AgentProfileRepositoryPort } from "../../domain/ports/profile-repository.port.js";
import type { SessionStorePort } from "../../domain/ports/session-store.port.js";
import type { SubAgentRepositoryPort } from "../../domain/ports/sub-agent-repository.port.js";
import type {
  SubAgentRequest,
  SubAgentResult,
  SubAgentRunnerPort,
} from "../../domain/ports/sub-agent-runner.port.js";
import type { EventBusPort } from "../../domain/events/agent-event.js";
import { SubAgentError } from "../../domain/errors/agent.errors.js";
import { AgentSession } from "../../domain/entities/agent-session.js";
import { SubAgentRun } from "../../domain/entities/sub-agent-run.js";
import { createSessionId } from "../../shared/id.js";
import { errorMessage, truncateText } from "../../shared/text.js";
import type { LLMPort } from "../../domain/ports/llm.port.js";
import type { ContextAssembler } from "../services/context-assembler.js";
import type { ModelRouter } from "../services/model-router.js";
import type { ToolRegistry } from "../services/tool-registry.js";
import type { CompactSessionUseCase } from "./compact-session.usecase.js";
import type { ExecuteToolUseCase } from "./execute-tool.usecase.js";
import { RunAgentTurnUseCase } from "./run-agent-turn.usecase.js";

export interface SubAgentRunnerOptions {
  maxDepth: number;
  maxSteps: number;
  maxRunMs: number;
  maxObservationChars: number;
}

/**
 * Runs one child conversation to completion. It is deliberately sequential:
 * the parent turn is blocked while the child works, so only one model request
 * exists at a time and the 16 GB memory budget is never doubled.
 */
export class SubAgentRunner implements SubAgentRunnerPort {
  private readonly turn: RunAgentTurnUseCase;

  constructor(
    private readonly deps: {
      profiles: AgentProfileRepositoryPort;
      sessions: SessionStorePort;
      runs: SubAgentRepositoryPort;
      registry: ToolRegistry;
      executeTool: ExecuteToolUseCase;
      llm: LLMPort;
      assembler: ContextAssembler;
      compacter?: CompactSessionUseCase;
      events?: EventBusPort;
      modelRouter?: ModelRouter;
    },
    private readonly options: SubAgentRunnerOptions,
  ) {
    this.turn = new RunAgentTurnUseCase(deps.llm, deps.registry, deps.executeTool, {
      maxSteps: options.maxSteps,
      maxObservationChars: options.maxObservationChars,
      maxSubAgentsPerTurn: 0,
      assembler: deps.assembler,
      ...(deps.compacter ? { compacter: deps.compacter } : {}),
      ...(deps.events ? { events: deps.events } : {}),
      ...(deps.modelRouter ? { modelRouter: deps.modelRouter } : {}),
    });
  }

  async run(request: SubAgentRequest): Promise<SubAgentResult> {
    request.signal?.throwIfAborted();

    const depth = request.parentDepth + 1;
    if (depth > this.options.maxDepth) {
      throw new SubAgentError(
        `Sub-agent depth limit reached (${this.options.maxDepth}). Finish the work in the current agent.`,
      );
    }

    const profile = await this.deps.profiles.get(request.agentId);
    if (!profile) {
      throw new SubAgentError(
        `Unknown agent profile "${request.agentId}". Use /agents to see available profiles.`,
      );
    }
    if (profile.canSpawn) {
      throw new SubAgentError(
        `Profile "${profile.id}" may spawn agents, so it cannot be used as a child. Choose a bounded profile such as researcher, reviewer, or writer.`,
      );
    }

    const child = AgentSession.create(createSessionId(), {
      agentId: profile.id,
      parentId: request.parentSessionId,
      depth,
    });
    const run = SubAgentRun.create({
      id: `run-${createSessionId()}`,
      parentSessionId: request.parentSessionId,
      childSessionId: child.id,
      parentAgentId: request.parentAgentId,
      agentId: profile.id,
      task: request.task,
      depth,
      createdAt: new Date().toISOString(),
    });

    await Promise.all([
      this.deps.sessions.save(child),
      this.deps.runs.save(run),
    ]);

    this.deps.events?.emit("subagent.started", {
      sessionId: request.parentSessionId,
      agentId: request.parentAgentId,
      data: {
        runId: run.id,
        childSessionId: child.id,
        agentId: profile.id,
        task: truncateText(request.task, 500),
        depth,
      },
    });

    const prompt = [
      request.task.trim(),
      request.context?.trim()
        ? `\n\nShared context from the parent:\n${truncateText(request.context.trim(), 4_000)}`
        : "",
      "\n\nReturn a compact summary for the parent: what you found or changed, file paths, and any open questions.",
    ].join("");

    const timeoutSignal = AbortSignal.timeout(this.options.maxRunMs);
    const signal = request.signal
      ? AbortSignal.any([request.signal, timeoutSignal])
      : timeoutSignal;

    try {
      const answer = await this.turn.execute({
        session: child,
        profile,
        prompt,
        signal,
      });
      const summary = truncateText(answer, 2_500);
      const steps = child.messages.filter((message) => message.role === "tool").length;
      run.finish({
        status: "completed",
        summary,
        steps,
        usage: child.usage,
      });
      await this.saveOutcome(child, run);
      this.emitFinished(request, run);
      return this.result(run);
    } catch (error) {
      const parentAborted = request.signal?.aborted === true;
      const timedOut = timeoutSignal.aborted && !parentAborted;
      const status = parentAborted ? "cancelled" : "failed";
      const errorText = timedOut
        ? `Sub-agent timed out after ${this.options.maxRunMs} ms.`
        : errorMessage(error);
      const summary = parentAborted
        ? "Sub-agent cancelled."
        : `Sub-agent failed: ${errorText}`;
      const steps = child.messages.filter((message) => message.role === "tool").length;

      run.finish({
        status,
        summary,
        error: errorText,
        steps,
        usage: child.usage,
      });
      await this.saveOutcome(child, run);
      this.emitFinished(request, run);

      if (parentAborted) {
        throw error;
      }
      return this.result(run);
    }
  }

  private async saveOutcome(child: AgentSession, run: SubAgentRun): Promise<void> {
    await Promise.all([
      this.deps.sessions.save(child),
      this.deps.runs.save(run),
    ]);
  }

  private emitFinished(request: SubAgentRequest, run: SubAgentRun): void {
    this.deps.events?.emit("subagent.finished", {
      sessionId: request.parentSessionId,
      agentId: request.parentAgentId,
      data: {
        runId: run.id,
        childSessionId: run.childSessionId,
        agentId: run.agentId,
        status: run.status,
        steps: run.steps,
        summary: truncateText(run.summary, 800),
        error: run.error,
        usage: run.usage,
      },
    });
  }

  private result(run: SubAgentRun): SubAgentResult {
    return {
      runId: run.id,
      childSessionId: run.childSessionId,
      status:
        run.status === "completed"
          ? "completed"
          : run.status === "cancelled"
            ? "cancelled"
            : "failed",
      summary: run.summary,
      steps: run.steps,
      usage: run.usage,
    };
  }
}
