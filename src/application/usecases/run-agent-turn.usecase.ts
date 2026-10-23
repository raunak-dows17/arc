import type { AgentSession } from "../../domain/entities/agent-session.js";
import { AgentTurnError } from "../../domain/errors/agent.errors.js";
import type { LLMPort } from "../../domain/ports/llm.port.js";
import type { ToolCall } from "../../domain/value-objects/tool-call.js";
import { truncateText } from "../../shared/text.js";
import {
  buildContextMessages,
  type ContextLimits,
} from "../services/context-builder.js";
import type { ToolRegistry } from "../services/tool-registry.js";
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
}

export interface RunAgentTurnInput {
  session: AgentSession;
  prompt: string;
  signal?: AbortSignal;
  callbacks?: AgentTurnCallbacks;
}

export interface RunAgentTurnOptions {
  maxSteps: number;
  systemPrompt: string;
  contextLimits: ContextLimits;
  maxObservationChars: number;
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
    const { session } = input;
    const callbacks = input.callbacks ?? {};
    const tools = this.registry.getDefinitions();
    session.addUserMessage(input.prompt);

    let lastCall: ToolCall | null = null;

    try {
      for (let step = 0; step < this.options.maxSteps; step += 1) {
        input.signal?.throwIfAborted();

        callbacks.onThinkingStart?.();
        let decision;
        try {
          decision = await this.llm.generateDecision({
            systemPrompt: this.options.systemPrompt,
            messages: buildContextMessages(
              session.messages,
              this.options.contextLimits,
            ),
            tools,
            ...(input.signal ? { signal: input.signal } : {}),
          });
        } finally {
          callbacks.onThinkingEnd?.();
        }

        input.signal?.throwIfAborted();

        if (decision.thought.trim()) {
          callbacks.onThought?.(decision.thought.trim());
        }

        if (decision.finalAnswer !== null) {
          session.addAssistantMessage(decision.finalAnswer);
          session.markCompleted();
          callbacks.onFinal?.(decision.finalAnswer);
          return decision.finalAnswer;
        }

        const call = decision.toolCall;
        if (!call) {
          throw new AgentTurnError(
            "The model returned neither a tool call nor a final answer.",
          );
        }

        callbacks.onToolCall?.(call);

        let outcome: ToolOutcome;
        if (lastCall?.equals(call)) {
          outcome = {
            ok: false,
            observation: `Duplicate call blocked. You already called "${call.name}" with identical arguments. Use the previous result or choose a different action.`,
          };
        } else {
          outcome = await this.executeTool.execute(call);
          lastCall = call;
        }

        const observation = truncateText(
          outcome.observation,
          this.options.maxObservationChars,
        );
        session.addToolResult(call.name, observation);
        callbacks.onToolResult?.(call, { ...outcome, observation });
      }

      throw new AgentTurnError(
        `Agent reached the ${this.options.maxSteps}-step limit without a final answer.`,
      );
    } catch (error) {
      session.markFailed();
      throw error;
    }
  }
}
