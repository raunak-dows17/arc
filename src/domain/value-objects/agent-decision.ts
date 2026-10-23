import type { ToolCall } from "./tool-call.js";

/**
 * One model decision: either use a tool or deliver the final answer.
 */
export class AgentDecision {
  private constructor(
    public readonly thought: string,
    public readonly toolCall: ToolCall | null,
    public readonly finalAnswer: string | null,
  ) {}

  static useTool(thought: string, call: ToolCall): AgentDecision {
    return new AgentDecision(thought, call, null);
  }

  static finish(thought: string, answer: string): AgentDecision {
    return new AgentDecision(thought, null, answer);
  }

  get isFinal(): boolean {
    return this.finalAnswer !== null;
  }
}
