import type { AgentDecision } from "../value-objects/agent-decision.js";
import type { ToolDefinition } from "./tool.port.js";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  systemPrompt: string;
  messages: readonly LlmMessage[];
  tools: readonly ToolDefinition[];
  signal?: AbortSignal;
}

/**
 * Domain-facing language model boundary. Implementations are responsible for
 * prompt transport, structured output enforcement, and retries.
 */
export interface LLMPort {
  generateDecision(request: LlmRequest): Promise<AgentDecision>;
}
