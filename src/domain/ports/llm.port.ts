import type { AgentDecision } from "../value-objects/agent-decision.js";
import type { LlmUsage } from "../entities/agent-session.js";
import type { ToolDefinition } from "./tool.port.js";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  systemPrompt: string;
  messages: readonly LlmMessage[];
  tools: readonly ToolDefinition[];
  /** Optional model override selected by the application-level router. */
  model?: string;
  signal?: AbortSignal;
}

export interface LlmDecisionResult {
  decision: AgentDecision;
  usage: LlmUsage;
}

/**
 * Domain-facing language model boundary. Implementations are responsible for
 * prompt transport, structured output enforcement, and retries.
 */
export interface LLMPort {
  generateDecision(request: LlmRequest): Promise<LlmDecisionResult>;
}

export interface TextGenerationResult {
  text: string;
  usage: LlmUsage;
}

export interface TextGenerationOptions {
  systemPrompt?: string;
  /** Optional model override selected by the application-level router. */
  model?: string;
  signal?: AbortSignal;
}

/**
 * Plain-text completion used for context compaction. It is separate from the
 * structured decision channel so the two can be tested independently.
 */
export interface TextGenerationPort {
  generateText(
    prompt: string,
    options?: TextGenerationOptions,
  ): Promise<TextGenerationResult>;
}
