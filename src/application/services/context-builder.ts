import type { SessionMessage } from "../../domain/entities/agent-session.js";
import type { LlmMessage } from "../../domain/ports/llm.port.js";
import { truncateText } from "../../shared/text.js";

export interface ContextLimits {
  maxMessages: number;
  maxContextChars: number;
  maxObservationChars: number;
}

/**
 * Builds a bounded chat history for the model. The newest messages win.
 * Tool observations are re-labelled as user messages because this agent uses
 * prompt-driven tool calling rather than Ollama's native tool channel.
 */
export function buildContextMessages(
  messages: readonly SessionMessage[],
  limits: ContextLimits,
): LlmMessage[] {
  const selected: LlmMessage[] = [];
  let totalChars = 0;

  for (
    let index = messages.length - 1;
    index >= 0 && selected.length < limits.maxMessages;
    index -= 1
  ) {
    const message = messages[index];
    if (!message) {
      continue;
    }

    const perMessageLimit =
      message.role === "tool"
        ? limits.maxObservationChars
        : limits.maxContextChars;
    const content = truncateText(message.content, perMessageLimit);
    const rendered =
      message.role === "tool"
        ? `Tool result from ${message.toolName ?? "unknown tool"}:\n${content}`
        : content;

    if (selected.length > 0 && totalChars + rendered.length > limits.maxContextChars) {
      break;
    }

    selected.push({
      role: message.role === "tool" ? "user" : message.role,
      content: rendered,
    });
    totalChars += rendered.length;
  }

  return selected.reverse();
}
