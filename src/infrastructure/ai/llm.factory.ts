import type {
  AgentDecision,
  LLMPort,
  LLMRequirements,
} from "../../domain/ports/llm.port.js";
import { env } from "../../shared/config/env.js";
import { OllamaLLMAdapter } from "./ollama-llm.adapter.js";

// Stubs serving as future extensible drop-in placeholders for standard commercial models
class OpenAILLMAdapter implements LLMPort {
  async generateDecision(): Promise<any> {
    throw new Error(
      "OpenAI client layer wrapper is not activated in configurations yet.",
    );
  }
}

class AnthropicLLMAdapter implements LLMPort {
  async generateDecision(): Promise<any> {
    throw new Error(
      "Anthropic client layer wrapper is not activated in configurations yet.",
    );
  }
}

export class LLMFactory {
  /**
   * Resolves the required structural client adapter at runtime matching application environment profiles.
   */
  static create(): LLMPort {
    switch (env.AI_PROVIDER) {
      case "ollama":
        return new OllamaLLMAdapter();
      case "openai":
        return new OpenAILLMAdapter();
      case "anthropic":
        return new AnthropicLLMAdapter();
      default:
        throw new Error(
          `Invalid vendor structural instance target specified: ${env.AI_PROVIDER}`,
        );
    }
  }
}
