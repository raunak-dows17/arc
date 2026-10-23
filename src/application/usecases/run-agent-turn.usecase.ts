import type { AgentProfile } from "../../domain/entities/agent-profile.js";
import type {
  AgentSession,
  SessionUsage,
} from "../../domain/entities/agent-session.js";
import { AgentTurnError } from "../../domain/errors/agent.errors.js";
import type { EventBusPort } from "../../domain/events/agent-event.js";
import type { ApprovalChannel } from "../../domain/ports/approval.port.js";
import type { LLMPort } from "../../domain/ports/llm.port.js";
import type { ToolCall } from "../../domain/value-objects/tool-call.js";
import { truncateText } from "../../shared/text.js";
import type { ContextAssembler } from "../services/context-assembler.js";
import type { ModelRouter } from "../services/model-router.js";
import type { ToolRegistry } from "../services/tool-registry.js";
import type { CompactSessionUseCase } from "./compact-session.usecase.js";
import type {
  ExecuteToolUseCase,
  ToolOutcome,
} from "./execute-tool.usecase.js";

export interface AgentTurnCallbacks {
  onThinkingStart?: () => void;
  onThinkingEnd?: () => void;
  onThought?: (thought: string) => void;
  onToolCall?: (call: ToolCall) => void;
  onToolResult?: (call: ToolCall, outcome: ToolOutcome) => void;
  onFinal?: (answer: string) => void;
  onUsage?: (usage: SessionUsage) => void;
}

export interface RunAgentTurnInput {
  session: AgentSession;
  profile: AgentProfile;
  prompt: string;
  signal?: AbortSignal;
  channel?: ApprovalChannel;
  callbacks?: AgentTurnCallbacks;
}

export interface RunAgentTurnOptions {
  /** Global cap; the profile's own maxSteps is applied as a second cap. */
  maxSteps: number;
  maxObservationChars: number;
  maxSubAgentsPerTurn: number;
  assembler: ContextAssembler;
  compacter?: CompactSessionUseCase;
  events?: EventBusPort;
  modelRouter?: ModelRouter;
}

/**
 * The autonomous loop. Repeats model decision -> tool execution -> observation
 * until the model produces a final answer, the step budget is exhausted, or the
 * turn is aborted.
 */
export class RunAgentTurnUseCase {
  constructor(
    private readonly llm: LLMPort,
    private readonly registry: ToolRegistry,
    private readonly executeTool: ExecuteToolUseCase,
    private readonly options: RunAgentTurnOptions,
  ) {}

  async execute(input: RunAgentTurnInput): Promise<string> {
    const { session, profile } = input;
    const callbacks = input.callbacks ?? {};
    const maxSteps = Math.max(1, Math.min(this.options.maxSteps, profile.maxSteps));
    let subAgentCalls = 0;
    session.addUserMessage(input.prompt);
    this.emit("turn.started", session, {
      profile: profile.id,
      prompt: truncateText(input.prompt, 1_000),
    });

    try {
      try {
        await this.options.compacter?.maybeCompact(session, input.signal);
      } catch (error) {
        if (input.signal?.aborted) {
          throw error;
        }
        // Compaction is best-effort; the normal history trim still applies.
      }

      let lastCall: ToolCall | null = null;

      for (let step = 0; step < maxSteps; step += 1) {
        input.signal?.throwIfAborted();

        callbacks.onThinkingStart?.();
        let decision;
        let usage;
        try {
          const context = await this.options.assembler.assemble(session, profile);
          const selection = this.options.modelRouter?.resolveForProfile(
            profile.id,
          );
          const result = await this.llm.generateDecision({
            systemPrompt: context.systemPrompt,
            messages: context.messages,
            tools: context.tools,
            ...(selection
              ? { provider: selection.provider, model: selection.model }
              : {}),
            ...(input.signal ? { signal: input.signal } : {}),
          });
          decision = result.decision;
          usage = result.usage;
        } finally {
          callbacks.onThinkingEnd?.();
        }

        session.recordUsage(usage);
        callbacks.onUsage?.(session.usage);
        input.signal?.throwIfAborted();

        if (decision.thought.trim()) {
          callbacks.onThought?.(decision.thought.trim());
        }

        if (decision.finalAnswer !== null) {
          session.addAssistantMessage(decision.finalAnswer);
          session.markCompleted();
          callbacks.onFinal?.(decision.finalAnswer);
          this.emit("turn.finished", session, {
            profile: profile.id,
            status: "completed",
            answer: truncateText(decision.finalAnswer, 2_000),
          });
          return decision.finalAnswer;
        }

        const call = decision.toolCall;
        if (!call) {
          throw new AgentTurnError(
            "The model returned neither a tool call nor a final answer.",
          );
        }

        callbacks.onToolCall?.(call);
        this.emit("tool.started", session, {
          tool: call.name,
          args: call.args,
        });

        let outcome: ToolOutcome;
        if (lastCall?.equals(call)) {
          outcome = {
            ok: false,
            observation: `Duplicate call blocked. You already called "${call.name}" with identical arguments. Use the previous result or choose a different action.`,
          };
        } else if (
          call.name === "run_agent" &&
          subAgentCalls >= this.options.maxSubAgentsPerTurn
        ) {
          outcome = {
            ok: false,
            observation: `Sub-agent budget reached (${this.options.maxSubAgentsPerTurn} per turn). Finish the current work yourself or answer with what you have.`,
          };
        } else {
          if (call.name === "run_agent") {
            subAgentCalls += 1;
          }
          outcome = await this.executeTool.execute(
            call,
            {
              sessionId: session.id,
              agentId: profile.id,
              depth: session.depth,
              allowedSkills: profile.skills,
              ...(input.channel ? { channel: input.channel } : {}),
              turnId: `${session.id}:step-${step + 1}`,
              ...(input.signal ? { signal: input.signal } : {}),
            },
            profile,
          );
          lastCall = call;
        }

        const observation = truncateText(
          outcome.observation,
          this.options.maxObservationChars,
        );
        session.addToolResult(call.name, observation);
        callbacks.onToolResult?.(call, { ...outcome, observation });
        this.emit("tool.finished", session, {
          tool: call.name,
          ok: outcome.ok,
          observation: truncateText(outcome.observation, 1_000),
        });
      }

      throw new AgentTurnError(
        `Agent reached the ${maxSteps}-step limit without a final answer.`,
      );
    } catch (error) {
      session.markFailed();
      this.emit("turn.finished", session, {
        profile: profile.id,
        status: input.signal?.aborted ? "aborted" : "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private emit(
    type: "turn.started" | "turn.finished" | "tool.started" | "tool.finished",
    session: AgentSession,
    data: Record<string, unknown>,
  ): void {
    this.options.events?.emit(type, {
      sessionId: session.id,
      agentId: session.agentId,
      data,
    });
  }
}
